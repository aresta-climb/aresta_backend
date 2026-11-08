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
