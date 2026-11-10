// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { construirZipEpubEmMemoria } from "./extrator_indice_epub.ts";
import {
  calcularSha256Base64,
  construirTokensAssinadosTeste,
  extrairUsuarioJwtSupabase,
  validarAtestadoOidcOpenPubkey,
  validarTokenAppCheck,
  verificarAssinaturaEpubXmlDsig,
} from "./verificador_assinatura_laudo.ts";

Deno.test("verificador_assinatura_laudo: valida Firebase App Check, JWT Supabase e atestado OIDC OpenPubkey", async () => {
  assertEquals(validarTokenAppCheck(null), false);
  assertEquals(validarTokenAppCheck("invalido"), false);
  assertEquals(validarTokenAppCheck("app_check_token_real_123"), true);

  const tokens = await construirTokensAssinadosTeste({
    userId: "usr_abc",
    provedor: "apple",
  });

  assertEquals(extrairUsuarioJwtSupabase(null), null);
  assertEquals(extrairUsuarioJwtSupabase("Bearer token_invalido"), null);
  const usr = extrairUsuarioJwtSupabase(`Bearer ${tokens.jwtSupabase}`);
  assertEquals(usr?.userId, "usr_abc");

  const validacaoOidc = await validarAtestadoOidcOpenPubkey({
    atestadoOidcJwt: tokens.atestadoOidcJwt,
    chavePublicaPem: tokens.chavePublicaPem,
  });
  assertEquals(validacaoOidc.valido, true);
  assertEquals(validacaoOidc.provedorOidc, "apple");

  const validacaoChaveErrada = await validarAtestadoOidcOpenPubkey({
    atestadoOidcJwt: tokens.atestadoOidcJwt,
    chavePublicaPem: "OUTRA_CHAVE_PUBLICA",
  });
  assertEquals(validacaoChaveErrada.valido, false);
});

Deno.test("verificador_assinatura_laudo: verifica pacote EPUB 3 assinado com XML-DSig e detecta adulteração de bytes", async () => {
  const encoder = new TextEncoder();
  const tokens = await construirTokensAssinadosTeste();

  const xhtmlBytes = encoder.encode("<html><body>Relatório Íntegro</body></html>");
  const digestXhtml = await calcularSha256Base64(xhtmlBytes);

  const signaturesXml = `<?xml version="1.0" encoding="UTF-8"?>
<signatures xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <Reference URI="OEBPS/relatorio.xhtml">
        <DigestValue>${digestXhtml}</DigestValue>
      </Reference>
    </SignedInfo>
    <SignatureValue>Y2hhdmVfYXNzaW5hdHVyYV9lY2RzYV92YWxpZGFfMTIzNDU2</SignatureValue>
    <KeyInfo>
      <X509Data>
        <X509Certificate>TUVVX0NFUlRfVEVTVEU=</X509Certificate>
      </X509Data>
    </KeyInfo>
    <Object Id="oidc-attestation">
      <OidcIdToken>${tokens.atestadoOidcJwt}</OidcIdToken>
    </Object>
  </Signature>
</signatures>`;

  const epubValido = construirZipEpubEmMemoria([
    { nome: "OEBPS/relatorio.xhtml", dados: xhtmlBytes },
    { nome: "META-INF/signatures.xml", dados: encoder.encode(signaturesXml) },
  ]);

  const resValido = await verificarAssinaturaEpubXmlDsig(epubValido);
  assertEquals(resValido.valido, true);
  assertEquals(resValido.fingerprintChave, tokens.fingerprintSha256);
  assertEquals(resValido.nomeMantenedor, "Renato Ferreira");

  // Adultera 1 byte do relatorio.xhtml
  const epubAdulterado = construirZipEpubEmMemoria([
    {
      nome: "OEBPS/relatorio.xhtml",
      dados: encoder.encode("<html><body>Relatório Adulterado</body></html>"),
    },
    { nome: "META-INF/signatures.xml", dados: encoder.encode(signaturesXml) },
  ]);
  const resAdulterado = await verificarAssinaturaEpubXmlDsig(epubAdulterado);
  assertEquals(resAdulterado.valido, false);
  assertEquals(
    resAdulterado.motivoErro?.includes("Divergência de hash SHA-256"),
    true,
  );
});

Deno.test("verificador_assinatura_laudo: extrai chave pública ECDSA P-256 (SPKI PEM) de dentro de <X509Certificate> quando <PublicKeyPem> está ausente", async () => {
  const encoder = new TextEncoder();
  const parChaves = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spkiBuffer = await crypto.subtle.exportKey("spki", parChaves.publicKey);
  const spkiBytes = new Uint8Array(spkiBuffer);

  let binarioSpki = "";
  for (const b of spkiBytes) {
    binarioSpki += String.fromCharCode(b);
  }
  const spkiBase64 = btoa(binarioSpki);
  const linhasSpki = spkiBase64.match(/.{1,64}/g) ?? [spkiBase64];
  const publicKeyPemReal = `-----BEGIN PUBLIC KEY-----\n${linhasSpki.join("\n")}\n-----END PUBLIC KEY-----`;

  // Simula certificado X.509 DER contendo cabeçalho ASN.1 + bloco SPKI P-256 (91 bytes) + assinatura
  const certDerBytes = new Uint8Array(40 + spkiBytes.byteLength + 64);
  certDerBytes.set([0x30, 0x82, 0x01, 0x20], 0);
  certDerBytes.set(spkiBytes, 40);
  certDerBytes.set([0x03, 0x40, 0x00], 40 + spkiBytes.byteLength);
  let binarioCert = "";
  for (const b of certDerBytes) {
    binarioCert += String.fromCharCode(b);
  }
  const certBase64 = btoa(binarioCert);

  // OIDC token foi emitido com nonce calculado sobre publicKeyPemReal (como faz o app Flutter)
  const tokens = await construirTokensAssinadosTeste({
    userId: "usr_ecdsa_real",
    nome: "Mantenedor P-256",
    chavePublicaPem: publicKeyPemReal,
  });

  const xhtmlBytes = encoder.encode("<html><body>Laudo P-256</body></html>");
  const digestXhtml = await calcularSha256Base64(xhtmlBytes);

  // XML sem <PublicKeyPem>, contendo apenas <X509Certificate>
  const signaturesXmlSemTagPubKey = `<?xml version="1.0" encoding="UTF-8"?>
<signatures xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <Reference URI="OEBPS/relatorio.xhtml">
        <DigestValue>${digestXhtml}</DigestValue>
      </Reference>
    </SignedInfo>
    <SignatureValue>Y2hhdmVfYXNzaW5hdHVyYV9lY2RzYV92YWxpZGFfMTIzNDU2</SignatureValue>
    <KeyInfo>
      <X509Data>
        <X509Certificate>${certBase64}</X509Certificate>
      </X509Data>
    </KeyInfo>
    <Object Id="oidc-attestation">
      <OidcIdToken>${tokens.atestadoOidcJwt}</OidcIdToken>
    </Object>
  </Signature>
</signatures>`;

  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/relatorio.xhtml", dados: xhtmlBytes },
    {
      nome: "META-INF/signatures.xml",
      dados: encoder.encode(signaturesXmlSemTagPubKey),
    },
  ]);

  const res = await verificarAssinaturaEpubXmlDsig(epub);
  assertEquals(res.valido, true);
  assertEquals(res.chavePublicaPem, publicKeyPemReal);
  assertEquals(res.fingerprintChave, tokens.fingerprintSha256);
});
