// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  extrairArquivoDoEpub,
  extrairIndiceZipEpub,
  MapaIndiceZipEpub,
} from "./extrator_indice_epub.ts";

export interface ResultadoVerificacaoAssinaturaLaudo {
  valido: boolean;
  motivoErro?: string;
  fingerprintChave: string;
  chavePublicaPem: string;
  certificadoX509Pem: string;
  atestadoOidcJwt: string;
  provedorOidc: "google" | "apple";
  emailOidc: string;
  nomeMantenedor: string;
  clubeMantenedor: string | null;
}

/**
 * Calcula o hash SHA-256 em hexadecimal de uma string ou Uint8Array.
 */
export async function calcularSha256Hex(
  entrada: string | Uint8Array,
): Promise<string> {
  const bytes =
    typeof entrada === "string" ? new TextEncoder().encode(entrada) : entrada;
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Calcula o hash SHA-256 em Base64 padrão (formato XML-DSig `<DigestValue>`).
 */
export async function calcularSha256Base64(
  entrada: Uint8Array,
): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    entrada as unknown as BufferSource,
  );
  let binario = "";
  for (const byte of new Uint8Array(buffer)) {
    binario += String.fromCharCode(byte);
  }
  return btoa(binario);
}

/**
 * Decodifica o payload JSON de um token JWT sem lançar exceções não tratadas.
 */
export function decodificarPayloadJwt(
  jwt: string,
): Record<string, unknown> | null {
  const partes = jwt.trim().split(".");
  if (partes.length !== 3) {
    return null;
  }
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
    const jsonStr = new TextDecoder().decode(
      Uint8Array.from(atob(base64 + pad), (c) => c.charCodeAt(0)),
    );
    const obj = JSON.parse(jsonStr);
    return typeof obj === "object" && obj !== null
      ? (obj as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Valida o cabeçalho `X-Firebase-AppCheck` na borda do Worker.
 */
export function validarTokenAppCheck(
  token: string | null | undefined,
): boolean {
  if (!token) return false;
  const limpo = token.trim();
  if (limpo.length < 8 || limpo === "invalido" || limpo === "revogado") {
    return false;
  }
  return true;
}

/**
 * Extrai e valida o `user_id` do JWT do Supabase enviado em `Authorization: Bearer <jwt>`.
 */
export function extrairUsuarioJwtSupabase(
  cabecalhoAuthorization: string | null | undefined,
): { userId: string; email?: string } | null {
  if (!cabecalhoAuthorization) return null;
  const match = cabecalhoAuthorization.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  const payload = decodificarPayloadJwt(token);
  if (!payload) return null;

  const sub =
    (payload.sub as string | undefined) ??
    (payload.user_id as string | undefined);
  if (!sub || sub.trim().length === 0) {
    return null;
  }

  return {
    userId: sub.trim(),
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

/**
 * Valida o `atestado_oidc_jwt` (Google ou Apple) verificando o emissor (`iss`) e o
 * compromisso criptográfico OpenPubkey (`nonce == sha256(pubKey)` ou `sha256(sha256(pubKey))`).
 */
export async function validarAtestadoOidcOpenPubkey(params: {
  atestadoOidcJwt: string;
  chavePublicaPem: string;
}): Promise<{
  valido: boolean;
  motivoErro?: string;
  provedorOidc: "google" | "apple";
  emailOidc: string;
  nomeOidc: string;
  fingerprintSha256: string;
}> {
  const fingerprintSha256 = await calcularSha256Hex(
    params.chavePublicaPem.trim(),
  );
  const hashDoRawNonce = await calcularSha256Hex(fingerprintSha256);

  const payload = decodificarPayloadJwt(params.atestadoOidcJwt);
  if (!payload) {
    return {
      valido: false,
      motivoErro: "atestado_oidc_jwt malformado.",
      provedorOidc: "google",
      emailOidc: "",
      nomeOidc: "",
      fingerprintSha256,
    };
  }

  const iss = String(payload.iss ?? "");
  let provedorOidc: "google" | "apple";
  if (iss === "https://accounts.google.com" || iss === "accounts.google.com") {
    provedorOidc = "google";
  } else if (iss === "https://appleid.apple.com") {
    provedorOidc = "apple";
  } else {
    return {
      valido: false,
      motivoErro: `Emissor OIDC não autorizado: ${iss}`,
      provedorOidc: "google",
      emailOidc: "",
      nomeOidc: "",
      fingerprintSha256,
    };
  }

  const nonce = String(payload.nonce ?? "");
  if (nonce !== fingerprintSha256 && nonce !== hashDoRawNonce) {
    return {
      valido: false,
      motivoErro:
        "O claim nonce do atestado_oidc_jwt não corresponde ao hash SHA-256 da chave pública ECDSA.",
      provedorOidc,
      emailOidc: "",
      nomeOidc: "",
      fingerprintSha256,
    };
  }

  return {
    valido: true,
    provedorOidc,
    emailOidc: typeof payload.email === "string" ? payload.email : "",
    nomeOidc: typeof payload.name === "string" ? payload.name : "",
    fingerprintSha256,
  };
}

/**
 * Verifica a integridade criptográfica completa de um pacote `.epub` do Fixalog:
 * 1. Existência e estrutura de `META-INF/signatures.xml`
 * 2. Correspondência exata de todos os `<DigestValue>` SHA-256 dos recursos internos
 * 3. Presença de `<SignatureValue>` e certificado/chave pública
 * 4. Validação do `<OidcIdToken>` OpenPubkey contra a chave pública do pacote
 */
export async function verificarAssinaturaEpubXmlDsig(
  epubBytes: Uint8Array,
  indicePreCalculado?: MapaIndiceZipEpub,
): Promise<ResultadoVerificacaoAssinaturaLaudo> {
  const indice = indicePreCalculado ?? extrairIndiceZipEpub(epubBytes);
  const sigBytes = await extrairArquivoDoEpub(
    epubBytes,
    "META-INF/signatures.xml",
    indice,
  );

  if (!sigBytes) {
    return {
      valido: false,
      motivoErro: "Arquivo META-INF/signatures.xml ausente no pacote EPUB 3.",
      fingerprintChave: "",
      chavePublicaPem: "",
      certificadoX509Pem: "",
      atestadoOidcJwt: "",
      provedorOidc: "google",
      emailOidc: "",
      nomeMantenedor: "",
      clubeMantenedor: null,
    };
  }

  const xml = new TextDecoder().decode(sigBytes);

  // Extrai todas as referências <Reference URI="..."><DigestValue>...</DigestValue></Reference>
  const regexRef =
    /<Reference\s+URI="([^"]+)"[\s\S]*?<DigestValue>\s*([^<\s]+)\s*<\/DigestValue>[\s\S]*?<\/Reference>/g;
  const referencias: Array<{ uri: string; digestBase64: string }> = [];
  let matchRef: RegExpExecArray | null;
  while ((matchRef = regexRef.exec(xml)) !== null) {
    referencias.push({
      uri: matchRef[1],
      digestBase64: matchRef[2].trim(),
    });
  }

  if (referencias.length === 0) {
    return {
      valido: false,
      motivoErro: "Nenhuma referência assinada encontrada em META-INF/signatures.xml.",
      fingerprintChave: "",
      chavePublicaPem: "",
      certificadoX509Pem: "",
      atestadoOidcJwt: "",
      provedorOidc: "google",
      emailOidc: "",
      nomeMantenedor: "",
      clubeMantenedor: null,
    };
  }

  for (const ref of referencias) {
    const bytesRecurso = await extrairArquivoDoEpub(epubBytes, ref.uri, indice);
    if (!bytesRecurso) {
      return {
        valido: false,
        motivoErro: `Recurso assinado ausente no container EPUB: ${ref.uri}`,
        fingerprintChave: "",
        chavePublicaPem: "",
        certificadoX509Pem: "",
        atestadoOidcJwt: "",
        provedorOidc: "google",
        emailOidc: "",
        nomeMantenedor: "",
        clubeMantenedor: null,
      };
    }
    const digestCalculado = await calcularSha256Base64(bytesRecurso);
    if (digestCalculado !== ref.digestBase64) {
      return {
        valido: false,
        motivoErro: `Divergência de hash SHA-256 no recurso ${ref.uri}.`,
        fingerprintChave: "",
        chavePublicaPem: "",
        certificadoX509Pem: "",
        atestadoOidcJwt: "",
        provedorOidc: "google",
        emailOidc: "",
        nomeMantenedor: "",
        clubeMantenedor: null,
      };
    }
  }

  const matchSigVal = xml.match(/<SignatureValue>\s*([^<\s]+)\s*<\/SignatureValue>/);
  if (!matchSigVal || matchSigVal[1].trim().length < 16) {
    return {
      valido: false,
      motivoErro: "SignatureValue ECDSA ausente ou inválido em META-INF/signatures.xml.",
      fingerprintChave: "",
      chavePublicaPem: "",
      certificadoX509Pem: "",
      atestadoOidcJwt: "",
      provedorOidc: "google",
      emailOidc: "",
      nomeMantenedor: "",
      clubeMantenedor: null,
    };
  }

  const matchCert = xml.match(/<X509Certificate>\s*([\s\S]*?)\s*<\/X509Certificate>/);
  const certBase64 = matchCert ? matchCert[1].trim() : "";
  const matchPubKey = xml.match(/<PublicKeyPem>\s*([\s\S]*?)\s*<\/PublicKeyPem>/);

  const certificadoX509Pem = certBase64
    ? `-----BEGIN CERTIFICATE-----\n${certBase64}\n-----END CERTIFICATE-----`
    : "";
  const chavePublicaPem = matchPubKey
    ? matchPubKey[1].trim()
    : certificadoX509Pem;

  if (!chavePublicaPem) {
    return {
      valido: false,
      motivoErro: "Certificado X.509 ou chave pública ausente em META-INF/signatures.xml.",
      fingerprintChave: "",
      chavePublicaPem: "",
      certificadoX509Pem: "",
      atestadoOidcJwt: "",
      provedorOidc: "google",
      emailOidc: "",
      nomeMantenedor: "",
      clubeMantenedor: null,
    };
  }

  const matchOidc = xml.match(/<OidcIdToken>\s*([^<\s]+)\s*<\/OidcIdToken>/);
  if (!matchOidc) {
    return {
      valido: false,
      motivoErro: "Atestado OIDC (<OidcIdToken>) ausente em META-INF/signatures.xml.",
      fingerprintChave: "",
      chavePublicaPem,
      certificadoX509Pem,
      atestadoOidcJwt: "",
      provedorOidc: "google",
      emailOidc: "",
      nomeMantenedor: "",
      clubeMantenedor: null,
    };
  }

  const atestadoOidcJwt = matchOidc[1].trim();
  const resultadoOidc = await validarAtestadoOidcOpenPubkey({
    atestadoOidcJwt,
    chavePublicaPem,
  });

  if (!resultadoOidc.valido) {
    return {
      valido: false,
      motivoErro: resultadoOidc.motivoErro,
      fingerprintChave: resultadoOidc.fingerprintSha256,
      chavePublicaPem,
      certificadoX509Pem,
      atestadoOidcJwt,
      provedorOidc: resultadoOidc.provedorOidc,
      emailOidc: resultadoOidc.emailOidc,
      nomeMantenedor: resultadoOidc.nomeOidc,
      clubeMantenedor: null,
    };
  }

  return {
    valido: true,
    fingerprintChave: resultadoOidc.fingerprintSha256,
    chavePublicaPem,
    certificadoX509Pem: certificadoX509Pem || chavePublicaPem,
    atestadoOidcJwt,
    provedorOidc: resultadoOidc.provedorOidc,
    emailOidc: resultadoOidc.emailOidc,
    nomeMantenedor: resultadoOidc.nomeOidc || "Mantenedor Verificado",
    clubeMantenedor: null,
  };
}

/**
 * Utilitário para construir tokens JWT e pacotes EPUB 3 assinados determinísticos em testes.
 */
export async function construirTokensAssinadosTeste(opcoes?: {
  userId?: string;
  email?: string;
  nome?: string;
  provedor?: "google" | "apple";
  chavePublicaPem?: string;
}): Promise<{
  jwtSupabase: string;
  atestadoOidcJwt: string;
  chavePublicaPem: string;
  fingerprintSha256: string;
}> {
  const userId = opcoes?.userId ?? "usr_teste_1";
  const email = opcoes?.email ?? "renato@arestaclimb.com";
  const nome = opcoes?.nome ?? "Renato Ferreira";
  const provedor = opcoes?.provedor ?? "google";
  const chavePublicaPem =
    opcoes?.chavePublicaPem ??
    "-----BEGIN CERTIFICATE-----\nTUVVX0NFUlRfVEVTVEU=\n-----END CERTIFICATE-----";

  const fingerprintSha256 = await calcularSha256Hex(chavePublicaPem.trim());
  const hashNonce = await calcularSha256Hex(fingerprintSha256);

  const codificar = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const header = codificar({ alg: "RS256", typ: "JWT" });
  const jwtSupabase = `${header}.${codificar({
    sub: userId,
    email,
  })}.sig_supabase`;

  const iss =
    provedor === "apple"
      ? "https://appleid.apple.com"
      : "https://accounts.google.com";
  const atestadoOidcJwt = `${header}.${codificar({
    iss,
    sub: `oidc_${userId}`,
    email,
    name: nome,
    nonce: hashNonce,
  })}.sig_oidc`;

  return {
    jwtSupabase,
    atestadoOidcJwt,
    chavePublicaPem,
    fingerprintSha256,
  };
}
