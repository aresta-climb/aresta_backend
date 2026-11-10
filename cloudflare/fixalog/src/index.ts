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
  MapaIndiceZipEpub,
  servirMidiaByteRangeDoR2,
} from "./extrator_indice_epub.ts";
import { relatarErroSentry } from "../../../supabase/functions/compartilhado/relator_sentry.ts";
import {
  AmbienteFixalog,
  BancoD1Fixalog,
  BucketR2Fixalog,
  ContextoExecucaoFixalog,
} from "./fakes/ambiente_fixalog_fake.ts";
import {
  dispararAlertaSegurancaFixalog,
  executarModeracaoAssincronaLaudo,
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
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Firebase-AppCheck, Range",
};

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
  const regexMat = /materiais\/([^/"]+)\/relatorio\.xhtml/g;
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

export const PRAZO_EXPIRACAO_STAGING_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Remove do bucket R2 todos os blocos temporários (`staging/`) cuja data de
 * upload tenha ultrapassado 14 dias, preservando uploads parciais de expedições
 * em andamento com menos de 14 dias.
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
    return {
      statusHttp: 200,
      jaEnviado: true,
      versao: versaoMesmoHash.versao,
      statusModeracao:
        (versaoMesmoHash.status_moderacao as
          | "em_analise"
          | "ativo"
          | "bloqueado") ?? "em_analise",
      urlPublica: `https://fixalog.app/v/${encodeURIComponent(idSessao)}`,
      hashEpub: versaoMesmoHash.hash_epub_sha256,
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
      "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  });
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

  if (!env.DB || !env.LAUDOS_BUCKET) {
    return respostaJson(
      { erro: "Bindings D1 ou R2 não configurados no Worker." },
      500,
    );
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
      const respostaJaEnviado: RespostaChunkLaudoFixalog = {
        id_sessao: idSessao,
        sha256: versaoExistente.hash_epub_sha256,
        finalizado: true,
        ja_enviado: true,
        versao: versaoExistente.versao,
        status_moderacao: versaoExistente.status_moderacao ?? "em_analise",
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

    return await servirMidiaByteRangeDoR2({
      bucket: env.LAUDOS_BUCKET,
      r2Key: versao.r2_key,
      entrada,
      cabecalhoRange: req.headers.get("Range"),
    });
  }

  // 8. GET /v/:id/epub e GET /v/:id/pdf
  const matchDownload = path.match(/^\/v\/([^/]+)\/(epub|pdf)$/);
  if (req.method === "GET" && matchDownload) {
    const idSessao = decodeURIComponent(matchDownload[1]);
    const formato = matchDownload[2];

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
      return new Response(await obj.arrayBuffer(), {
        status: 200,
        headers: {
          "Content-Type": "application/epub+zip",
          "Content-Disposition": `attachment; filename="${idSessao}-v${versao.versao}.epub"`,
          "Cache-Control": CABECALHO_CACHE_MIDIA_IMUTAVEL,
        },
      });
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
    const versaoExibida = await env.DB.prepare(
      "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
    )
      .bind(idSessao, versaoSolicitada)
      .first<LinhaVersoesLaudoFixalog>();

    if (!versaoExibida) {
      return new Response("Versão do laudo não encontrada.", { status: 404 });
    }

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
      const objXhtml = await env.LAUDOS_BUCKET.get(versaoExibida.r2_key, {
        range: { offset: entradaXhtml.offset, length: entradaXhtml.length },
      });
      if (objXhtml) {
        xhtmlOriginal = new TextDecoder().decode(await objXhtml.arrayBuffer());
      }
    }

    let cssOriginal = "";
    if (entradaCss) {
      const objCss = await env.LAUDOS_BUCKET.get(versaoExibida.r2_key, {
        range: { offset: entradaCss.offset, length: entradaCss.length },
      });
      if (objCss) {
        cssOriginal = new TextDecoder().decode(await objCss.arrayBuffer());
      }
    }

    const materiaisAnexosXhtml: MaterialAnexoXhtml[] = [];
    for (const [caminhoZip, entradaMat] of Object.entries(indice)) {
      const matchMat = caminhoZip.match(
        /^OEBPS\/materiais\/([^/]+)\/(?:OEBPS\/)?relatorio\.xhtml$/,
      );
      if (matchMat) {
        const objMat = await env.LAUDOS_BUCKET.get(versaoExibida.r2_key, {
          range: { offset: entradaMat.offset, length: entradaMat.length },
        });
        if (objMat) {
          materiaisAnexosXhtml.push({
            idMaterial: matchMat[1],
            xhtml: new TextDecoder().decode(await objMat.arrayBuffer()),
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

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
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
