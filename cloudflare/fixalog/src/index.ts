// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ChaveUsuarioFixalog,
  RequisicaoDenunciaLaudoFixalog,
  RequisicaoRegistroChaveFixalog,
  RespostaChunkLaudoFixalog,
  RespostaDenunciaLaudoFixalog,
  RespostaListaLaudosFixalog,
  RespostaStatusLaudoFixalog,
  RespostaUploadLaudoFixalog,
} from "../../../aresta_api/openapi/generated/ts/fixalog.ts";
import {
  LinhaChavesUsuarioFixalog,
  LinhaLaudosFixalog,
  LinhaVersoesLaudoFixalog,
} from "../../../aresta_api/sql/generated/ts/fixalog_d1_sql.ts";
import {
  CABECALHO_CACHE_MIDIA_IMUTAVEL,
  extrairArquivoDoEpub,
  extrairIndiceZipEpub,
  lerBytesEntradaDoR2,
  MapaIndiceZipEpub,
  servirMidiaByteRangeDoR2,
} from "./extrator_indice_epub.ts";
import { relatarErroSentry } from "../../../supabase/functions/compartilhado/relator_sentry.ts";
import {
  AmbienteFixalog,
  BancoD1Fixalog,
  BucketR2Fixalog,
  CacheBordaFixalog,
  ContextoExecucaoFixalog,
} from "./fakes/ambiente_fixalog_fake.ts";
import {
  consumirNotificacaoFalhaTecnicaRecente,
  dispararAlertaSegurancaFixalog,
  executarModeracaoAssincronaLaudo,
  verificarTokenHmacCsamScan,
} from "./moderador_midia_ia.ts";
import {
  MaterialAnexoXhtml,
  renderizarPaginaEmAnaliseLaudo,
  renderizarPaginaPublicaLaudo,
} from "./renderizador_pagina_laudo.ts";
import {
  calcularSha256Hex,
  extrairUsuarioJwtSupabase,
  validarAtestadoOidcOpenPubkey,
  validarTokenAppCheck,
  verificarAssinaturaEpubXmlDsig,
} from "./verificador_assinatura_laudo.ts";

export const cabecalhosCorsFixalog = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Firebase-AppCheck, Range",
};

function obterCacheBorda(env: AmbienteFixalog): CacheBordaFixalog | null {
  if (env.cacheBorda) {
    return env.cacheBorda;
  }
  const globalCaches = (
    globalThis as unknown as {
      caches?: { default?: CacheBordaFixalog };
    }
  ).caches;
  return globalCaches?.default ?? null;
}

async function invalidarCacheBordaLaudo(
  env: AmbienteFixalog,
  idSessao: string,
  maxVersao = 10,
): Promise<void> {
  const cache = obterCacheBorda(env);
  if (!cache) return;
  const idCodificado = encodeURIComponent(idSessao);
  const urls = [
    `https://fixalog.app/v/${idCodificado}`,
    `https://fixalog.app/v/${idCodificado}/epub`,
    `https://fixalog.app/sitemap.xml`,
  ];
  for (let v = 1; v <= Math.max(1, maxVersao); v++) {
    urls.push(`https://fixalog.app/v/${idCodificado}?v=${v}`);
    urls.push(`https://fixalog.app/v/${idCodificado}/epub?v=${v}`);
  }
  await Promise.all(urls.map((u) => cache.delete(u).catch(() => false)));
}

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cabecalhosCorsFixalog,
    },
  });
}

function extrairMetadadosXhtml(xhtml: string): {
  titulo: string;
  categoria: "MANUTENCAO" | "MATERIAL";
  idProtocolo: string;
  materiaisReferenciados: string[];
} {
  const matchTitle = xhtml.match(/<title>([\s\S]*?)<\/title>/i);
  const titulo = matchTitle ? matchTitle[1].trim() : "Laudo Técnico Fixalog";
  const ehMaterial =
    xhtml.includes("material_registration") ||
    xhtml.includes("cadastro_material") ||
    titulo.toLowerCase().includes("material");
  const categoria = ehMaterial ? "MATERIAL" : "MANUTENCAO";
  const idProtocolo = ehMaterial
    ? "material_registration"
    : "manutencao_ferragens";

  const materiais = new Set<string>();
  const regexMat = /materiais\/([^/"]+)\/(?:OEBPS\/)?relatorio\.xhtml/g;
  let m: RegExpExecArray | null;
  while ((m = regexMat.exec(xhtml)) !== null) {
    materiais.add(m[1]);
  }

  return {
    titulo,
    categoria,
    idProtocolo,
    materiaisReferenciados: Array.from(materiais),
  };
}

async function garantirColunasProgressoNoD1(
  db: BancoD1Fixalog,
): Promise<void> {
  try {
    await db
      .prepare(
        "ALTER TABLE versoes_laudo_fixalog ADD COLUMN verificacao_concluida INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  } catch {
    // Coluna já existente no D1
  }
  try {
    await db
      .prepare(
        "ALTER TABLE versoes_laudo_fixalog ADD COLUMN verificacao_total INTEGER NOT NULL DEFAULT 1",
      )
      .run();
  } catch {
    // Coluna já existente no D1
  }
}

export const PRAZO_EXPIRACAO_STAGING_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Remove do bucket R2 todos os blocos temporários (`staging/`) cuja data de
 * upload tenha ultrapassado 7 dias, preservando uploads parciais pausados ou
 * cancelados pelo usuário com menos de 7 dias.
 */
export async function limparStagingExpiradoNoR2(
  bucket: BucketR2Fixalog,
  agoraMs: number = Date.now(),
): Promise<number> {
  const listagem = await bucket.list({ prefix: "staging/" });
  const chavesExpiradas: string[] = [];
  for (const obj of listagem.objects) {
    const uploadedMs = obj.uploaded ? obj.uploaded.getTime() : agoraMs;
    if (agoraMs - uploadedMs > PRAZO_EXPIRACAO_STAGING_MS) {
      chavesExpiradas.push(obj.key);
    }
  }
  if (chavesExpiradas.length > 0) {
    await bucket.delete(chavesExpiradas);
  }
  return chavesExpiradas.length;
}

async function listarChunksRecebidosNoR2(
  bucket: BucketR2Fixalog,
  idSessao: string,
  sha256: string,
): Promise<number[]> {
  const prefixo = `staging/${idSessao}/${sha256.toLowerCase()}/chunk_`;
  const listagem = await bucket.list({ prefix: prefixo });
  const indices: number[] = [];
  for (const obj of listagem.objects) {
    const sufixo = obj.key.slice(prefixo.length);
    const idx = Number.parseInt(sufixo, 10);
    if (!Number.isNaN(idx) && idx >= 0) {
      indices.push(idx);
    }
  }
  indices.sort((a, b) => a - b);
  return indices;
}

/**
 * Se uma versão já armazenada no R2 estiver em `status_moderacao === "bloqueado"`
 * exclusivamente por falha técnica (`ERRO_TECNICO_VERIFICACAO:*`) de uma tentativa anterior,
 * reseta seu status para `"em_analise"` e reagenda a moderação assíncrona lendo o `.epub`
 * diretamente do R2 sem exigir novo upload de blocos pelo aplicativo.
 */
async function reagendarModeracaoSeErroTecnico(params: {
  env: AmbienteFixalog;
  db: BancoD1Fixalog;
  bucket: BucketR2Fixalog;
  ctx?: ContextoExecucaoFixalog;
  idSessao: string;
  userId: string;
  versaoRow: LinhaVersoesLaudoFixalog;
  respeitarNotificacaoPendente?: boolean;
}): Promise<LinhaVersoesLaudoFixalog> {
  const {
    env,
    db,
    bucket,
    ctx,
    idSessao,
    userId,
    versaoRow,
    respeitarNotificacaoPendente = false,
  } = params;

  const ehErroTecnico =
    versaoRow.status_moderacao === "bloqueado" &&
    (versaoRow.motivo_moderacao ?? "").startsWith("ERRO_TECNICO_VERIFICACAO:");

  if (!ehErroTecnico) {
    return versaoRow;
  }

  if (
    respeitarNotificacaoPendente &&
    consumirNotificacaoFalhaTecnicaRecente(idSessao, versaoRow.versao)
  ) {
    return versaoRow;
  }

  // Limpa qualquer notificação residual e reinicia a verificação no D1
  consumirNotificacaoFalhaTecnicaRecente(idSessao, versaoRow.versao);
  const totalEtapas = Math.max(1, versaoRow.verificacao_total ?? 1);
  await db
    .prepare(
      "UPDATE versoes_laudo_fixalog SET status_moderacao = ?, motivo_moderacao = ?, verificacao_concluida = ?, verificacao_total = ? WHERE id_sessao = ? AND versao = ?",
    )
    .bind("em_analise", null, 0, totalEtapas, idSessao, versaoRow.versao)
    .run();

  const tarefaReprocessamento = (async () => {
    const objR2 = await bucket.get(versaoRow.r2_key);
    if (!objR2) {
      return;
    }
    const epubBytes = new Uint8Array(await objR2.arrayBuffer());
    let indicePreCalculado: MapaIndiceZipEpub | undefined;
    try {
      indicePreCalculado = JSON.parse(
        versaoRow.indices_zip_json,
      ) as MapaIndiceZipEpub;
    } catch {
      indicePreCalculado = undefined;
    }
    await executarModeracaoAssincronaLaudo({
      env,
      idSessao,
      versao: versaoRow.versao,
      userId,
      epubBytes,
      indicePreCalculado,
    });
    await invalidarCacheBordaLaudo(env, idSessao, versaoRow.versao);
  })();

  await invalidarCacheBordaLaudo(env, idSessao, versaoRow.versao);
  if (ctx) {
    ctx.waitUntil(tarefaReprocessamento);
  } else {
    await tarefaReprocessamento;
  }

  return {
    ...versaoRow,
    status_moderacao: "em_analise",
    motivo_moderacao: null,
    verificacao_concluida: 0,
    verificacao_total: totalEtapas,
  };
}

async function persistirVersaoEpubValidada(params: {
  env: AmbienteFixalog;
  db: BancoD1Fixalog;
  bucket: BucketR2Fixalog;
  ctx?: ContextoExecucaoFixalog;
  idSessao: string;
  userId: string;
  epubBytes: Uint8Array;
  hashEpub: string;
}): Promise<
  | { erro: string; statusHttp: number }
  | {
      statusHttp: number;
      jaEnviado: boolean;
      versao: number;
      statusModeracao: "em_analise" | "ativo" | "bloqueado";
      urlPublica: string;
      hashEpub: string;
    }
> {
  const { env, db, bucket, ctx, idSessao, userId, epubBytes, hashEpub } =
    params;

  await garantirColunasProgressoNoD1(db);

  const laudoExistente = await db
    .prepare("SELECT * FROM laudos_fixalog WHERE id_sessao = ?")
    .bind(idSessao)
    .first<LinhaLaudosFixalog>();

  if (laudoExistente && laudoExistente.user_id !== userId) {
    return {
      erro: "Apenas a conta autora original pode publicar novas versões deste laudo.",
      statusHttp: 403,
    };
  }

  const versaoMesmoHash = await db
    .prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND hash_epub_sha256 = ?",
    )
    .bind(idSessao, hashEpub)
    .first<LinhaVersoesLaudoFixalog>();

  if (versaoMesmoHash) {
    const versaoAtualizada = await reagendarModeracaoSeErroTecnico({
      env,
      db,
      bucket,
      ctx,
      idSessao,
      userId,
      versaoRow: versaoMesmoHash,
      respeitarNotificacaoPendente: false,
    });
    return {
      statusHttp: 200,
      jaEnviado: true,
      versao: versaoAtualizada.versao,
      statusModeracao:
        (versaoAtualizada.status_moderacao as
          | "em_analise"
          | "ativo"
          | "bloqueado") ?? "em_analise",
      urlPublica: `https://fixalog.app/v/${encodeURIComponent(idSessao)}`,
      hashEpub: versaoAtualizada.hash_epub_sha256,
    };
  }

  let indiceZip: MapaIndiceZipEpub;
  try {
    indiceZip = extrairIndiceZipEpub(epubBytes);
  } catch (e) {
    return {
      erro: `Pacote EPUB malformado: ${(e as Error).message}`,
      statusHttp: 400,
    };
  }

  const verificacao = await verificarAssinaturaEpubXmlDsig(
    epubBytes,
    indiceZip,
  );
  if (!verificacao.valido) {
    return {
      erro: verificacao.motivoErro ?? "Assinatura XML-DSig inválida.",
      statusHttp: 400,
    };
  }

  const novaVersao = laudoExistente
    ? (laudoExistente.versao_atual ?? 1) + 1
    : 1;
  const r2Key = `laudos/${idSessao}/v${novaVersao}.epub`;
  await bucket.put(r2Key, epubBytes);

  const xhtmlBytes = await extrairArquivoDoEpub(
    epubBytes,
    "OEBPS/relatorio.xhtml",
    indiceZip,
  );
  const xhtmlTexto = xhtmlBytes ? new TextDecoder().decode(xhtmlBytes) : "";
  const meta = extrairMetadadosXhtml(xhtmlTexto);
  const agora = new Date().toISOString();

  await db
    .prepare(
      "INSERT OR REPLACE INTO chaves_usuario_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      verificacao.fingerprintChave,
      userId,
      verificacao.chavePublicaPem,
      verificacao.certificadoX509Pem,
      verificacao.atestadoOidcJwt,
      verificacao.provedorOidc,
      verificacao.nomeMantenedor,
      verificacao.clubeMantenedor,
      agora,
    )
    .run();

  if (!laudoExistente) {
    await db
      .prepare(
        "INSERT INTO laudos_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        idSessao,
        userId,
        meta.categoria,
        meta.idProtocolo,
        meta.titulo,
        null,
        null,
        null,
        1,
        agora,
        agora,
      )
      .run();
  } else {
    await db
      .prepare(
        "UPDATE laudos_fixalog SET titulo = ?, escalada_uid = ?, latitude = ?, longitude = ?, versao_atual = ?, atualizado_em = ? WHERE id_sessao = ?",
      )
      .bind(
        meta.titulo,
        laudoExistente.escalada_uid,
        laudoExistente.latitude,
        laudoExistente.longitude,
        novaVersao,
        agora,
        idSessao,
      )
      .run();
  }

  await db
    .prepare(
      "INSERT INTO versoes_laudo_fixalog (id_sessao, versao, r2_key, tamanho_bytes, hash_epub_sha256, fingerprint_chave, nome_mantenedor, clube_mantenedor, indices_zip_json, materiais_referenciados_json, status_moderacao, motivo_moderacao, verificacao_concluida, verificacao_total, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      idSessao,
      novaVersao,
      r2Key,
      epubBytes.byteLength,
      hashEpub,
      verificacao.fingerprintChave,
      verificacao.nomeMantenedor,
      verificacao.clubeMantenedor,
      JSON.stringify(indiceZip),
      JSON.stringify(meta.materiaisReferenciados),
      "em_analise",
      null,
      0,
      1,
      agora,
    )
    .run();

  const tarefaModeracao = executarModeracaoAssincronaLaudo({
    env,
    idSessao,
    versao: novaVersao,
    userId,
    epubBytes,
    indicePreCalculado: indiceZip,
  }).then(async (res) => {
    await invalidarCacheBordaLaudo(env, idSessao, novaVersao);
    return res;
  });
  await invalidarCacheBordaLaudo(env, idSessao, novaVersao);
  if (ctx) {
    ctx.waitUntil(tarefaModeracao);
  } else {
    await tarefaModeracao;
  }

  return {
    statusHttp: 201,
    jaEnviado: false,
    versao: novaVersao,
    statusModeracao: "em_analise",
    urlPublica: `https://fixalog.app/v/${encodeURIComponent(idSessao)}`,
    hashEpub,
  };
}

/**
 * Roteador principal de requisições HTTP do Cloudflare Worker `fixalog`.
 */
export async function processarRequisicaoFixalog(
  req: Request,
  env: AmbienteFixalog,
  ctx?: ContextoExecucaoFixalog,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCorsFixalog });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/" || path === "/health") {
    return respostaJson({ status: "operacional", servico: "fixalog-worker" });
  }

  if (req.method === "GET" && path === "/robots.txt") {
    const robotsTxt = [
      "User-agent: *",
      "Allow: /v/",
      "Disallow: /api/",
      "Disallow: /__csam_scan/",
      "Sitemap: https://fixalog.app/sitemap.xml",
      "",
    ].join("\n");
    return new Response(robotsTxt, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  if (!env.DB || !env.LAUDOS_BUCKET) {
    return respostaJson(
      { erro: "Bindings D1 ou R2 não configurados no Worker." },
      500,
    );
  }

  if (req.method === "GET" && path === "/sitemap.xml") {
    const cacheBorda = obterCacheBorda(env);
    const cacheSitemap = await cacheBorda?.match(req.url);
    if (cacheSitemap) {
      return cacheSitemap;
    }

    const { results } = await env.DB.prepare(
      "SELECT l.id_sessao, l.atualizado_em FROM laudos_fixalog l INNER JOIN versoes_laudo_fixalog v ON l.id_sessao = v.id_sessao AND l.versao_atual = v.versao WHERE v.status_moderacao = 'ativo' ORDER BY l.atualizado_em DESC",
    ).all<{ id_sessao: string; atualizado_em: string }>();

    const urlsXml = results
      .map(
        (item) =>
          `  <url>\n    <loc>https://fixalog.app/v/${encodeURIComponent(
            item.id_sessao,
          )}</loc>\n    <lastmod>${item.atualizado_em}</lastmod>\n  </url>`,
      )
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml}\n</urlset>`;
    const resSitemap = new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
    await cacheBorda?.put(req.url, resSitemap.clone());
    return resSitemap;
  }

  // Rota interna assinada por HMAC para inspeção de imagens pelo Cloudflare CSAM Scanning Tool
  const matchCsamScan = path.match(/^\/__csam_scan\/([^/]+)\/v(\d+)\/(.+)$/);
  if (req.method === "GET" && matchCsamScan) {
    const idSessao = decodeURIComponent(matchCsamScan[1]);
    const versao = Number.parseInt(matchCsamScan[2], 10);
    const caminhoInterno = matchCsamScan[3]
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    const token = url.searchParams.get("token") ?? "";

    const tokenValido = await verificarTokenHmacCsamScan({
      idSessao,
      versao,
      caminho: caminhoInterno,
      token,
      segredo: env.SENTRY_DSN,
    });
    if (!tokenValido) {
      return new Response("Token HMAC de inspeção CSAM inválido.", {
        status: 403,
      });
    }

    const versaoRow = await env.DB.prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
    )
      .bind(idSessao, versao)
      .first<LinhaVersoesLaudoFixalog>();
    if (!versaoRow) {
      return new Response("Versão não encontrada.", { status: 404 });
    }

    const indice = JSON.parse(versaoRow.indices_zip_json) as MapaIndiceZipEpub;
    const entrada = indice[caminhoInterno];
    if (!entrada) {
      return new Response("Entrada de imagem não encontrada no índice.", {
        status: 404,
      });
    }

    const bytesImg = await lerBytesEntradaDoR2({
      bucket: env.LAUDOS_BUCKET,
      r2Key: versaoRow.r2_key,
      entrada,
    });
    if (!bytesImg) {
      return new Response("Arquivo não encontrado no R2.", { status: 404 });
    }

    return new Response(new Uint8Array(bytesImg), {
      status: 200,
      headers: {
        "Content-Type": entrada.mimeType,
        "Content-Length": String(bytesImg.byteLength),
        "Cache-Control": "no-store",
      },
    });
  }

  // 1. POST /api/v1/chaves
  if (req.method === "POST" && path === "/api/v1/chaves") {
    if (!validarTokenAppCheck(req.headers.get("X-Firebase-AppCheck"))) {
      return respostaJson(
        { erro: "Token Firebase App Check ausente ou inválido." },
        401,
      );
    }
    const usuario = extrairUsuarioJwtSupabase(req.headers.get("Authorization"));
    if (!usuario) {
      return respostaJson({ erro: "JWT do Supabase ausente ou inválido." }, 401);
    }

    const body = (await req.json()) as RequisicaoRegistroChaveFixalog;
    const validacaoOidc = await validarAtestadoOidcOpenPubkey({
      atestadoOidcJwt: body.atestado_oidc_jwt,
      chavePublicaPem: body.chave_publica_pem,
    });
    if (!validacaoOidc.valido) {
      return respostaJson(
        { erro: validacaoOidc.motivoErro ?? "Atestado OIDC inválido." },
        400,
      );
    }

    const agora = new Date().toISOString();
    const registro: ChaveUsuarioFixalog = {
      fingerprint_sha256: validacaoOidc.fingerprintSha256,
      user_id: usuario.userId,
      chave_publica_pem: body.chave_publica_pem,
      certificado_x509_pem: body.certificado_x509_pem,
      atestado_oidc_jwt: body.atestado_oidc_jwt,
      provedor_oidc: validacaoOidc.provedorOidc,
      nome_declarado: body.nome_declarado,
      clube_declarado: body.clube_declarado ?? null,
      criado_em: agora,
    };

    await env.DB.prepare(
      "INSERT OR REPLACE INTO chaves_usuario_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        registro.fingerprint_sha256,
        registro.user_id,
        registro.chave_publica_pem,
        registro.certificado_x509_pem,
        registro.atestado_oidc_jwt,
        registro.provedor_oidc,
        registro.nome_declarado,
        registro.clube_declarado,
        registro.criado_em,
      )
      .run();

    return respostaJson(registro, 201);
  }

  // 2. GET /api/v1/laudos
  if (req.method === "GET" && path === "/api/v1/laudos") {
    if (!validarTokenAppCheck(req.headers.get("X-Firebase-AppCheck"))) {
      return respostaJson(
        { erro: "Token Firebase App Check ausente ou inválido." },
        401,
      );
    }
    const usuario = extrairUsuarioJwtSupabase(req.headers.get("Authorization"));
    if (!usuario) {
      return respostaJson({ erro: "JWT do Supabase ausente ou inválido." }, 401);
    }

    const { results } = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE user_id = ?",
    )
      .bind(usuario.userId)
      .all<LinhaLaudosFixalog>();

    const resposta: RespostaListaLaudosFixalog = {
      laudos: results.map((r) => ({
        ...r,
        categoria: r.categoria as "MANUTENCAO" | "MATERIAL",
      })),
    };
    return respostaJson(resposta, 200);
  }

  // 3. GET /api/v1/laudos/:id/status
  const matchStatus = path.match(/^\/api\/v1\/laudos\/([^/]+)\/status$/);
  if (req.method === "GET" && matchStatus) {
    if (!validarTokenAppCheck(req.headers.get("X-Firebase-AppCheck"))) {
      return respostaJson(
        { erro: "Token Firebase App Check ausente ou inválido." },
        401,
      );
    }
    const usuario = extrairUsuarioJwtSupabase(req.headers.get("Authorization"));
    if (!usuario) {
      return respostaJson({ erro: "JWT do Supabase ausente ou inválido." }, 401);
    }

    const idSessao = decodeURIComponent(matchStatus[1]);
    const sha256 = url.searchParams.get("sha256")?.toLowerCase() ?? null;

    await garantirColunasProgressoNoD1(env.DB);

    const laudoExistente = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .first<LinhaLaudosFixalog>();

    if (laudoExistente && laudoExistente.user_id !== usuario.userId) {
      return respostaJson(
        {
          erro: "Apenas a conta proprietária do laudo pode consultar seu status de processamento.",
        },
        403,
      );
    }

    let versaoEncontrada: LinhaVersoesLaudoFixalog | null = null;
    if (sha256) {
      versaoEncontrada = await env.DB.prepare(
        "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND hash_epub_sha256 = ?",
      )
        .bind(idSessao, sha256)
        .first<LinhaVersoesLaudoFixalog>();
    } else if (laudoExistente) {
      versaoEncontrada = await env.DB.prepare(
        "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
      )
        .bind(idSessao, laudoExistente.versao_atual ?? 1)
        .first<LinhaVersoesLaudoFixalog>();
    }

    if (versaoEncontrada) {
      versaoEncontrada = await reagendarModeracaoSeErroTecnico({
        env,
        db: env.DB,
        bucket: env.LAUDOS_BUCKET,
        ctx,
        idSessao,
        userId: usuario.userId,
        versaoRow: versaoEncontrada,
        respeitarNotificacaoPendente: true,
      });
      const resposta: RespostaStatusLaudoFixalog = {
        id_sessao: idSessao,
        sha256: versaoEncontrada.hash_epub_sha256,
        ja_enviado: true,
        versao: versaoEncontrada.versao,
        status_moderacao: versaoEncontrada.status_moderacao ?? "em_analise",
        motivo_moderacao: versaoEncontrada.motivo_moderacao ?? null,
        verificacao_concluida: versaoEncontrada.verificacao_concluida ?? 0,
        verificacao_total: versaoEncontrada.verificacao_total ?? 1,
        chunks_recebidos: [],
      };
      return respostaJson(resposta, 200);
    }

    const chunksRecebidos = sha256
      ? await listarChunksRecebidosNoR2(env.LAUDOS_BUCKET, idSessao, sha256)
      : [];

    const resposta: RespostaStatusLaudoFixalog = {
      id_sessao: idSessao,
      sha256,
      ja_enviado: false,
      versao: null,
      status_moderacao: null,
      motivo_moderacao: null,
      verificacao_concluida: 0,
      verificacao_total: 1,
      chunks_recebidos: chunksRecebidos,
    };
    return respostaJson(resposta, 200);
  }

  // 4. PUT /api/v1/laudos/:id/chunk
  const matchChunk = path.match(/^\/api\/v1\/laudos\/([^/]+)\/chunk$/);
  if (req.method === "PUT" && matchChunk) {
    if (!validarTokenAppCheck(req.headers.get("X-Firebase-AppCheck"))) {
      return respostaJson(
        { erro: "Token Firebase App Check ausente ou inválido." },
        401,
      );
    }
    const usuario = extrairUsuarioJwtSupabase(req.headers.get("Authorization"));
    if (!usuario) {
      return respostaJson({ erro: "JWT do Supabase ausente ou inválido." }, 401);
    }

    const idSessao = decodeURIComponent(matchChunk[1]);
    const sha256 = url.searchParams.get("sha256")?.toLowerCase() ?? "";
    const index = Number.parseInt(url.searchParams.get("index") ?? "-1", 10);
    const total = Number.parseInt(url.searchParams.get("total") ?? "0", 10);

    if (!sha256 || Number.isNaN(index) || Number.isNaN(total) || index < 0 || total < 1 || index >= total) {
      return respostaJson(
        { erro: "Parâmetros sha256, index ou total inválidos." },
        400,
      );
    }

    const laudoExistente = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .first<LinhaLaudosFixalog>();

    if (laudoExistente && laudoExistente.user_id !== usuario.userId) {
      return respostaJson(
        {
          erro: "Apenas a conta autora original pode publicar novas versões deste laudo.",
        },
        403,
      );
    }

    const versaoExistente = await env.DB.prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND hash_epub_sha256 = ?",
    )
      .bind(idSessao, sha256)
      .first<LinhaVersoesLaudoFixalog>();

    if (versaoExistente) {
      const versaoAtualizada = await reagendarModeracaoSeErroTecnico({
        env,
        db: env.DB,
        bucket: env.LAUDOS_BUCKET,
        ctx,
        idSessao,
        userId: usuario.userId,
        versaoRow: versaoExistente,
        respeitarNotificacaoPendente: false,
      });
      const respostaJaEnviado: RespostaChunkLaudoFixalog = {
        id_sessao: idSessao,
        sha256: versaoAtualizada.hash_epub_sha256,
        finalizado: true,
        ja_enviado: true,
        versao: versaoAtualizada.versao,
        status_moderacao: versaoAtualizada.status_moderacao ?? "em_analise",
        url_publica: `https://fixalog.app/v/${encodeURIComponent(idSessao)}`,
        chunks_recebidos: [],
      };
      return respostaJson(respostaJaEnviado, 200);
    }

    const bytesChunk = new Uint8Array(await req.arrayBuffer());
    const chaveChunk = `staging/${idSessao}/${sha256}/chunk_${index}`;
    await env.LAUDOS_BUCKET.put(chaveChunk, bytesChunk);

    const chunksRecebidos = await listarChunksRecebidosNoR2(
      env.LAUDOS_BUCKET,
      idSessao,
      sha256,
    );

    if (chunksRecebidos.length < total) {
      const respostaParcial: RespostaChunkLaudoFixalog = {
        id_sessao: idSessao,
        sha256,
        finalizado: false,
        ja_enviado: false,
        versao: null,
        status_moderacao: null,
        url_publica: null,
        chunks_recebidos: chunksRecebidos,
      };
      return respostaJson(respostaParcial, 200);
    }

    // Todos os blocos 0..total-1 estão presentes: concatena e finaliza
    const partes: Uint8Array[] = [];
    const chavesStaging: string[] = [];
    let tamanhoTotal = 0;
    for (let i = 0; i < total; i++) {
      const k = `staging/${idSessao}/${sha256}/chunk_${i}`;
      chavesStaging.push(k);
      const obj = await env.LAUDOS_BUCKET.get(k);
      if (!obj) {
        return respostaJson(
          { erro: `Bloco ausente no staging R2: chunk_${i}` },
          400,
        );
      }
      const arr = new Uint8Array(await obj.arrayBuffer());
      partes.push(arr);
      tamanhoTotal += arr.byteLength;
    }

    const epubCompleto = new Uint8Array(tamanhoTotal);
    let offsetCursor = 0;
    for (const p of partes) {
      epubCompleto.set(p, offsetCursor);
      offsetCursor += p.byteLength;
    }

    const hashCalculado = (await calcularSha256Hex(epubCompleto)).toLowerCase();
    if (hashCalculado !== sha256) {
      await env.LAUDOS_BUCKET.delete(chavesStaging);
      return respostaJson(
        {
          erro: `Divergência de integridade SHA-256 nos blocos concatenados: esperado ${sha256}, obtido ${hashCalculado}.`,
        },
        400,
      );
    }

    const resultado = await persistirVersaoEpubValidada({
      env,
      db: env.DB,
      bucket: env.LAUDOS_BUCKET,
      ctx,
      idSessao,
      userId: usuario.userId,
      epubBytes: epubCompleto,
      hashEpub: hashCalculado,
    });

    if ("erro" in resultado) {
      if (resultado.statusHttp === 400) {
        await env.LAUDOS_BUCKET.delete(chavesStaging);
      }
      return respostaJson({ erro: resultado.erro }, resultado.statusHttp);
    }

    await env.LAUDOS_BUCKET.delete(chavesStaging);

    const respostaFinal: RespostaChunkLaudoFixalog = {
      id_sessao: idSessao,
      sha256: resultado.hashEpub,
      finalizado: true,
      ja_enviado: resultado.jaEnviado,
      versao: resultado.versao,
      status_moderacao: resultado.statusModeracao,
      url_publica: resultado.urlPublica,
      chunks_recebidos: chunksRecebidos,
    };
    return respostaJson(respostaFinal, resultado.statusHttp);
  }

  // 5. PUT /api/v1/laudos/:id
  const matchUpload = path.match(/^\/api\/v1\/laudos\/([^/]+)$/);
  if (req.method === "PUT" && matchUpload) {
    if (!validarTokenAppCheck(req.headers.get("X-Firebase-AppCheck"))) {
      return respostaJson(
        { erro: "Token Firebase App Check ausente ou inválido." },
        401,
      );
    }
    const usuario = extrairUsuarioJwtSupabase(req.headers.get("Authorization"));
    if (!usuario) {
      return respostaJson({ erro: "JWT do Supabase ausente ou inválido." }, 401);
    }

    const idSessao = decodeURIComponent(matchUpload[1]);
    const epubBytes = new Uint8Array(await req.arrayBuffer());
    const hashEpub = (await calcularSha256Hex(epubBytes)).toLowerCase();

    const resultado = await persistirVersaoEpubValidada({
      env,
      db: env.DB,
      bucket: env.LAUDOS_BUCKET,
      ctx,
      idSessao,
      userId: usuario.userId,
      epubBytes,
      hashEpub,
    });

    if ("erro" in resultado) {
      return respostaJson({ erro: resultado.erro }, resultado.statusHttp);
    }

    const resposta: RespostaUploadLaudoFixalog = {
      id_sessao: idSessao,
      versao: resultado.versao,
      status_moderacao: resultado.statusModeracao,
      url_publica: resultado.urlPublica,
      hash_epub_sha256: resultado.hashEpub,
      ja_enviado: resultado.jaEnviado,
    };
    return respostaJson(resposta, resultado.statusHttp);
  }

  // 5b. DELETE /api/v1/laudos/:id (exclusão pelo autor no R2, D1 e Cache de Borda)
  if (req.method === "DELETE" && matchUpload) {
    if (!validarTokenAppCheck(req.headers.get("X-Firebase-AppCheck"))) {
      return respostaJson(
        { erro: "Token Firebase App Check ausente ou inválido." },
        401,
      );
    }
    const usuario = extrairUsuarioJwtSupabase(req.headers.get("Authorization"));
    if (!usuario) {
      return respostaJson({ erro: "JWT do Supabase ausente ou inválido." }, 401);
    }

    const idSessao = decodeURIComponent(matchUpload[1]);
    const laudoExistente = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .first<LinhaLaudosFixalog>();

    if (!laudoExistente) {
      return respostaJson({ erro: "Laudo não encontrado." }, 404);
    }
    if (laudoExistente.user_id !== usuario.userId) {
      return respostaJson(
        { erro: "Apenas a conta autora original pode remover este laudo." },
        403,
      );
    }

    const objetosLaudo = await env.LAUDOS_BUCKET.list({
      prefix: `laudos/${idSessao}/`,
    });
    const objetosStaging = await env.LAUDOS_BUCKET.list({
      prefix: `staging/${idSessao}/`,
    });
    const chavesParaRemover = [
      ...objetosLaudo.objects.map((o) => o.key),
      ...objetosStaging.objects.map((o) => o.key),
    ];
    if (chavesParaRemover.length > 0) {
      await env.LAUDOS_BUCKET.delete(chavesParaRemover);
    }

    await env.DB.prepare("DELETE FROM versoes_laudo_fixalog WHERE id_sessao = ?")
      .bind(idSessao)
      .run();
    await env.DB.prepare("DELETE FROM laudos_fixalog WHERE id_sessao = ?")
      .bind(idSessao)
      .run();
    await invalidarCacheBordaLaudo(
      env,
      idSessao,
      laudoExistente.versao_atual ?? 10,
    );

    return respostaJson({ removido: true, id_sessao: idSessao }, 200);
  }

  // 6. POST /api/v1/laudos/:id/denunciar
  const matchDenuncia = path.match(/^\/api\/v1\/laudos\/([^/]+)\/denunciar$/);
  if (req.method === "POST" && matchDenuncia) {
    const idSessao = decodeURIComponent(matchDenuncia[1]);
    const laudo = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .first<LinhaLaudosFixalog>();

    if (!laudo) {
      return respostaJson({ erro: "Laudo não encontrado." }, 404);
    }

    const body = (await req.json()) as RequisicaoDenunciaLaudoFixalog;
    const versaoAlvo = laudo.versao_atual ?? 1;

    await env.DB.prepare(
      "UPDATE versoes_laudo_fixalog SET status_moderacao = ?, motivo_moderacao = ? WHERE id_sessao = ? AND versao = ?",
    )
      .bind("suspenso", `DENUNCIA:${body.motivo}`, idSessao, versaoAlvo)
      .run();

    await invalidarCacheBordaLaudo(env, idSessao, versaoAlvo);

    await dispararAlertaSegurancaFixalog({
      env,
      idSessao,
      versao: versaoAlvo,
      userId: laudo.user_id,
      tipoEvento: "DENUNCIA_LAUDO",
      motivo: body.motivo,
      detalhes: body.detalhes ?? null,
    });

    const resposta: RespostaDenunciaLaudoFixalog = {
      registrado: true,
      status_moderacao: "suspenso",
    };
    return respostaJson(resposta, 200);
  }

  // 7. GET /v/:id/midias/*
  const matchMidia = path.match(/^\/v\/([^/]+)\/midias\/(.+)$/);
  if (req.method === "GET" && matchMidia) {
    const cabecalhoRange = req.headers.get("Range");
    const cacheBorda = obterCacheBorda(env);
    if (!cabecalhoRange) {
      const hitMidia = await cacheBorda?.match(req.url);
      if (hitMidia) {
        return hitMidia;
      }
    }

    const idSessao = decodeURIComponent(matchMidia[1]);
    const caminhoInterno = decodeURIComponent(matchMidia[2]);

    const laudo = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .first<LinhaLaudosFixalog>();
    if (!laudo) {
      return new Response("Laudo não encontrado.", { status: 404 });
    }

    const versaoSolicitada = Number.parseInt(
      url.searchParams.get("v") ?? String(laudo.versao_atual ?? 1),
      10,
    );
    const versao = await env.DB.prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
    )
      .bind(idSessao, versaoSolicitada)
      .first<LinhaVersoesLaudoFixalog>();

    if (!versao) {
      return new Response("Versão do laudo não encontrada.", { status: 404 });
    }
    if (versao.status_moderacao !== "ativo") {
      return new Response(
        "Mídia indisponível enquanto o laudo não estiver com status ativo.",
        { status: versao.status_moderacao === "em_analise" ? 403 : 451 },
      );
    }

    const indice = JSON.parse(versao.indices_zip_json) as MapaIndiceZipEpub;
    const entrada =
      indice[caminhoInterno] ?? indice[`OEBPS/${caminhoInterno}`];
    if (!entrada) {
      return new Response("Mídia não encontrada no índice do EPUB.", {
        status: 404,
      });
    }

    const respostaMidia = await servirMidiaByteRangeDoR2({
      bucket: env.LAUDOS_BUCKET,
      r2Key: versao.r2_key,
      entrada,
      cabecalhoRange,
    });
    if (!cabecalhoRange && respostaMidia.status === 200) {
      await cacheBorda?.put(req.url, respostaMidia.clone());
    }
    return respostaMidia;
  }

  // 8. GET /v/:id/epub e GET /v/:id/pdf
  const matchDownload = path.match(/^\/v\/([^/]+)\/(epub|pdf)$/);
  if (req.method === "GET" && matchDownload) {
    const idSessao = decodeURIComponent(matchDownload[1]);
    const formato = matchDownload[2];
    const cacheBorda = obterCacheBorda(env);
    if (formato === "epub") {
      const hitEpub = await cacheBorda?.match(req.url);
      if (hitEpub) {
        return hitEpub;
      }
    }

    const laudo = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .first<LinhaLaudosFixalog>();
    if (!laudo) {
      return new Response("Laudo não encontrado.", { status: 404 });
    }

    const versaoSolicitada = Number.parseInt(
      url.searchParams.get("v") ?? String(laudo.versao_atual ?? 1),
      10,
    );
    const versao = await env.DB.prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
    )
      .bind(idSessao, versaoSolicitada)
      .first<LinhaVersoesLaudoFixalog>();
    if (!versao || versao.status_moderacao !== "ativo") {
      return new Response("Artefato indisponível.", { status: 403 });
    }

    const obj = await env.LAUDOS_BUCKET.get(versao.r2_key);
    if (!obj) {
      return new Response("Arquivo não encontrado no R2.", { status: 404 });
    }

    if (formato === "epub") {
      const resEpub = new Response(await obj.arrayBuffer(), {
        status: 200,
        headers: {
          "Content-Type": "application/epub+zip",
          "Content-Disposition": `attachment; filename="${idSessao}-v${versao.versao}.epub"`,
          "Cache-Control": CABECALHO_CACHE_MIDIA_IMUTAVEL,
        },
      });
      await cacheBorda?.put(req.url, resEpub.clone());
      return resEpub;
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/v/${encodeURIComponent(idSessao)}?v=${versao.versao}&print=1`,
      },
    });
  }

  // 9. GET /v/:id
  const matchPagina = path.match(/^\/v\/([^/]+)$/);
  if (req.method === "GET" && matchPagina) {
    const cacheBorda = obterCacheBorda(env);
    const hitPagina = await cacheBorda?.match(req.url);
    if (hitPagina) {
      return hitPagina;
    }

    const idSessao = decodeURIComponent(matchPagina[1]);
    const laudo = await env.DB.prepare(
      "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .first<LinhaLaudosFixalog>();

    if (!laudo) {
      return new Response("Laudo não encontrado.", { status: 404 });
    }

    const versaoSolicitada = Number.parseInt(
      url.searchParams.get("v") ?? String(laudo.versao_atual ?? 1),
      10,
    );
    let versaoExibida = await env.DB.prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
    )
      .bind(idSessao, versaoSolicitada)
      .first<LinhaVersoesLaudoFixalog>();

    if (!versaoExibida) {
      return new Response("Versão do laudo não encontrada.", { status: 404 });
    }

    versaoExibida = await reagendarModeracaoSeErroTecnico({
      env,
      db: env.DB,
      bucket: env.LAUDOS_BUCKET,
      ctx,
      idSessao,
      userId: laudo.user_id,
      versaoRow: versaoExibida,
      respeitarNotificacaoPendente: true,
    });

    if (versaoExibida.status_moderacao === "em_analise") {
      return new Response(
        renderizarPaginaEmAnaliseLaudo({ laudo, versaoExibida }),
        {
          status: 202,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (versaoExibida.status_moderacao !== "ativo") {
      return new Response(
        "Laudo bloqueado ou suspenso por violação dos termos de segurança.",
        { status: 451 },
      );
    }

    const { results: todasVersoes } = await env.DB.prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ?",
    )
      .bind(idSessao)
      .all<LinhaVersoesLaudoFixalog>();

    const chaveInfo = await env.DB.prepare(
      "SELECT * FROM chaves_usuario_fixalog WHERE fingerprint_sha256 = ?",
    )
      .bind(versaoExibida.fingerprint_chave)
      .first<LinhaChavesUsuarioFixalog>();

    const contagemRow = await env.DB.prepare(
      "SELECT COUNT(DISTINCT id_sessao) AS total FROM versoes_laudo_fixalog WHERE fingerprint_chave = ?",
    )
      .bind(versaoExibida.fingerprint_chave)
      .first<{ total: number }>();

    const indice = JSON.parse(
      versaoExibida.indices_zip_json,
    ) as MapaIndiceZipEpub;
    const entradaXhtml = indice["OEBPS/relatorio.xhtml"];
    const entradaCss = indice["OEBPS/estilo.css"];

    let xhtmlOriginal = "<body></body>";
    if (entradaXhtml) {
      const bytesXhtml = await lerBytesEntradaDoR2({
        bucket: env.LAUDOS_BUCKET,
        r2Key: versaoExibida.r2_key,
        entrada: entradaXhtml,
      });
      if (bytesXhtml) {
        xhtmlOriginal = new TextDecoder().decode(bytesXhtml);
      }
    }

    let cssOriginal = "";
    if (entradaCss) {
      const bytesCss = await lerBytesEntradaDoR2({
        bucket: env.LAUDOS_BUCKET,
        r2Key: versaoExibida.r2_key,
        entrada: entradaCss,
      });
      if (bytesCss) {
        cssOriginal = new TextDecoder().decode(bytesCss);
      }
    }

    const materiaisAnexosXhtml: MaterialAnexoXhtml[] = [];
    for (const [caminhoZip, entradaMat] of Object.entries(indice)) {
      const matchMat = caminhoZip.match(
        /^(OEBPS\/materiais\/([^/]+)(?:\/OEBPS)?)\/relatorio\.xhtml$/,
      );
      if (matchMat) {
        const bytesMat = await lerBytesEntradaDoR2({
          bucket: env.LAUDOS_BUCKET,
          r2Key: versaoExibida.r2_key,
          entrada: entradaMat,
        });
        if (bytesMat) {
          materiaisAnexosXhtml.push({
            idMaterial: matchMat[2],
            xhtml: new TextDecoder().decode(bytesMat),
            prefixoInternoOebps: matchMat[1],
          });
        }
      }
    }

    const html = renderizarPaginaPublicaLaudo({
      laudo,
      versaoExibida,
      todasVersoes,
      chaveInfo,
      totalLaudosAssinadosPelaChave: contagemRow?.total ?? 1,
      xhtmlOriginal,
      cssOriginal,
      materiaisAnexosXhtml,
    });

    const respostaPagina = new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": CABECALHO_CACHE_MIDIA_IMUTAVEL,
      },
    });
    await cacheBorda?.put(req.url, respostaPagina.clone());
    return respostaPagina;
  }

  return respostaJson({ erro: "Rota não encontrada." }, 404);
}

export default {
  async fetch(
    req: Request,
    env: AmbienteFixalog,
    ctx?: ContextoExecucaoFixalog,
  ): Promise<Response> {
    try {
      return await processarRequisicaoFixalog(req, env, ctx);
    } catch (erro) {
      if (env.SENTRY_DSN) {
        await relatarErroSentry(erro, {
          dsn: env.SENTRY_DSN,
          servico: "aresta-fixalog-worker",
          requisicao: req,
          contextoExecucao: ctx,
          fetchFn: (env.fetchExterno ?? fetch) as typeof fetch,
        });
      }
      return respostaJson({ erro: "Erro interno no Worker do Fixalog." }, 500);
    }
  },

  async scheduled(
    evento: { scheduledTime?: number; cron?: string },
    env: AmbienteFixalog,
    ctx?: ContextoExecucaoFixalog,
  ): Promise<void> {
    if (!env.LAUDOS_BUCKET) return;
    const tarefa = limparStagingExpiradoNoR2(
      env.LAUDOS_BUCKET,
      evento.scheduledTime ?? Date.now(),
    );
    if (ctx) {
      ctx.waitUntil(tarefa);
    } else {
      await tarefa;
    }
  },
};
