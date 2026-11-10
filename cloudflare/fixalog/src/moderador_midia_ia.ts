// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  extrairArquivoDoEpub,
  extrairIndiceZipEpub,
  MapaIndiceZipEpub,
} from "./extrator_indice_epub.ts";
import { relatarErroSentry } from "../../../supabase/functions/compartilhado/relator_sentry.ts";
import { AmbienteFixalog } from "./fakes/ambiente_fixalog_fake.ts";

export const MODELO_VISION_MODERACAO = "@cf/meta/llama-3.2-11b-vision-instruct";

export interface ResultadoModeracaoLaudo {
  status: "ativo" | "bloqueado";
  motivo: string | null;
  totalImagensInspecionadas: number;
  totalIframesVideoInspecionados: number;
}

/**
 * Gera um token HMAC-SHA256 de curta duração para autorizar a rota interna
 * `GET /__csam_scan/:idSessao/v:versao/:caminho?token=<hmac>`, permitindo que o
 * Cloudflare CSAM Scanning Tool inspecione os bytes da imagem na borda da zona `fixalog.app`.
 */
export async function gerarTokenHmacCsamScan(params: {
  idSessao: string;
  versao: number;
  caminho: string;
  segredo?: string;
}): Promise<string> {
  const segredoEfetivo =
    params.segredo?.trim() || "fixalog-csam-internal-secret";
  const encoder = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(segredoEfetivo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mensagem = encoder.encode(
    `${params.idSessao}:v${params.versao}:${params.caminho}`,
  );
  const assinatura = new Uint8Array(
    await crypto.subtle.sign("HMAC", chave, mensagem),
  );
  return Array.from(assinatura)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifica em tempo constante se o token HMAC da rota `GET /__csam_scan/*` é válido.
 */
export async function verificarTokenHmacCsamScan(params: {
  idSessao: string;
  versao: number;
  caminho: string;
  token: string;
  segredo?: string;
}): Promise<boolean> {
  if (!params.token || params.token.length !== 64) {
    return false;
  }
  const esperado = await gerarTokenHmacCsamScan({
    idSessao: params.idSessao,
    versao: params.versao,
    caminho: params.caminho,
    segredo: params.segredo,
  });
  if (esperado.length !== params.token.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) {
    diff |= esperado.charCodeAt(i) ^ params.token.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Dispara alerta imediato para `alertas.arestaclimb.com` (ou `env.ALERTA_URL`) e Sentry
 * quando ocorre bloqueio por CSAM/NSFW, falha técnica fail-closed ou denúncia de usuário.
 */
export async function dispararAlertaSegurancaFixalog(params: {
  env: AmbienteFixalog;
  idSessao: string;
  versao: number;
  userId?: string;
  tipoEvento:
    | "BLOQUEIO_CSAM_NSFW"
    | "EMERGENCIA_FALHA_MODERACAO"
    | "DENUNCIA_LAUDO";
  motivo: string;
  detalhes?: string | null;
  nivel?: "error" | "fatal";
  erroOriginal?: unknown;
}): Promise<void> {
  const url =
    params.env.ALERTA_URL ?? "https://alertas.arestaclimb.com/api/v1/alertas";
  const fetcher = params.env.fetchExterno ?? fetch;

  try {
    await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origem: "fixalog-worker",
        tipo_evento: params.tipoEvento,
        nivel: params.nivel ?? "error",
        id_sessao: params.idSessao,
        versao: params.versao,
        user_id: params.userId ?? null,
        motivo: params.motivo,
        detalhes: params.detalhes ?? null,
        ocorrido_em: new Date().toISOString(),
      }),
    });
  } catch {
    // Não interrompe a transição de estado no D1 caso o webhook externo falhe
  }

  if (params.env.SENTRY_DSN) {
    const erroRelato =
      params.erroOriginal instanceof Error
        ? new Error(
            `[${params.tipoEvento}] Laudo ${params.idSessao} (v${params.versao}): ${params.motivo} — ${params.erroOriginal.message}`,
          )
        : new Error(
            `[${params.tipoEvento}] Laudo ${params.idSessao} (v${params.versao}): ${params.motivo}`,
          );
    await relatarErroSentry(erroRelato, {
      dsn: params.env.SENTRY_DSN,
      servico: "aresta-fixalog-worker",
      nivel: params.nivel ?? "error",
      tags: {
        tipo_evento: params.tipoEvento,
        id_sessao: params.idSessao,
      },
      extras: {
        versao: params.versao,
        user_id: params.userId ?? null,
        motivo: params.motivo,
        detalhes: params.detalhes ?? null,
      },
      fetchFn: fetcher as typeof fetch,
    });
  }
}

/**
 * Executa a esteira assíncrona de moderação em 3 camadas em modo estritamente *fail-closed*
 * sobre todas as fotos, posters (`_poster.jpg`) e keyframes de vídeo (`_kf_*s.jpg`) do laudo:
 * 1. Sub-requisição `GET /__csam_scan/:idSessao/v:versao/:caminho?token=<hmac>` para o Cloudflare CSAM Scanning Tool
 * 2. Classificação CSAM (`S4`) via Cloudflare Workers AI Vision (com auto-envio de `{ prompt: "agree" }` no erro `5016`)
 * 3. Classificação NSFW/Gore (`S12`) via Cloudflare Workers AI Vision
 * Se qualquer etapa falhar tecnicamente ou acusar violação, bloqueia a versão (`status_moderacao = 'bloqueado'`)
 * e dispara alerta imediato (com `level: 'fatal'` no Sentry para falhas técnicas).
 */
export async function executarModeracaoAssincronaLaudo(params: {
  env: AmbienteFixalog;
  idSessao: string;
  versao: number;
  userId: string;
  epubBytes: Uint8Array;
  indicePreCalculado?: MapaIndiceZipEpub;
}): Promise<ResultadoModeracaoLaudo> {
  const { env, idSessao, versao, userId, epubBytes } = params;
  const indice = params.indicePreCalculado ?? extrairIndiceZipEpub(epubBytes);
  const fetcher = env.fetchExterno ?? fetch;

  let totalImagensInspecionadas = 0;
  let totalIframesVideoInspecionados = 0;
  let totalEtapas = 1;
  let etapasConcluidas = 0;

  const bloquearVersao = async (
    motivo: string,
    identificadorMidia: string,
    nivel: "error" | "fatal" = "error",
    erroOriginal?: unknown,
  ): Promise<ResultadoModeracaoLaudo> => {
    const motivoCompleto = `${motivo}:${identificadorMidia}`;
    if (env.DB) {
      await env.DB.prepare(
        "UPDATE versoes_laudo_fixalog SET status_moderacao = ?, motivo_moderacao = ?, verificacao_concluida = ?, verificacao_total = ? WHERE id_sessao = ? AND versao = ?",
      )
        .bind(
          "bloqueado",
          motivoCompleto,
          etapasConcluidas,
          totalEtapas,
          idSessao,
          versao,
        )
        .run();
    }

    await dispararAlertaSegurancaFixalog({
      env,
      idSessao,
      versao,
      userId,
      tipoEvento:
        nivel === "fatal" ? "EMERGENCIA_FALHA_MODERACAO" : "BLOQUEIO_CSAM_NSFW",
      motivo,
      detalhes: `Mídia bloqueada: ${identificadorMidia}`,
      nivel,
      erroOriginal,
    });

    return {
      status: "bloqueado",
      motivo: motivoCompleto,
      totalImagensInspecionadas,
      totalIframesVideoInspecionados,
    };
  };

  // Verifica se todo vídeo .mp4 possui seu poster correspondente empacotado
  const chavesIndice = Object.keys(indice);
  for (const caminho of chavesIndice) {
    if (caminho.toLowerCase().endsWith(".mp4")) {
      const baseSemExt = caminho.slice(0, -4);
      const possuiPoster = chavesIndice.some((k) => {
        const kLower = k.toLowerCase();
        const baseLower = baseSemExt.toLowerCase();
        return (
          kLower === `${baseLower}_poster.jpg` ||
          kLower === `${baseLower}.jpg` ||
          kLower.startsWith(`${baseLower}_kf_`)
        );
      });
      if (!possuiPoster) {
        return await bloquearVersao(
          "ERRO_TECNICO_VERIFICACAO:VIDEO_SEM_POSTER",
          caminho,
          "fatal",
        );
      }
    }
  }

  const amostrasParaInspecionar: Array<{
    identificador: string;
    bytes: Uint8Array;
    ehIframeVideo: boolean;
  }> = [];

  for (const caminho of chavesIndice) {
    const lower = caminho.toLowerCase();
    const ehImagem =
      lower.endsWith(".webp") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png");

    if (!ehImagem) {
      continue;
    }

    const bytesImg = await extrairArquivoDoEpub(epubBytes, caminho, indice);
    if (!bytesImg || bytesImg.byteLength === 0) {
      return await bloquearVersao(
        "ERRO_TECNICO_VERIFICACAO:IMAGEM_VAZIA_OU_ILEGIVEL",
        caminho,
        "fatal",
      );
    }

    const ehQuadroVideo =
      lower.endsWith("_poster.jpg") || /_kf_\d+s\.jpe?g$/.test(lower);
    amostrasParaInspecionar.push({
      identificador: caminho,
      bytes: bytesImg,
      ehIframeVideo: ehQuadroVideo,
    });
  }

  totalEtapas = Math.max(1, amostrasParaInspecionar.length);

  if (env.DB) {
    await env.DB.prepare(
      "UPDATE versoes_laudo_fixalog SET verificacao_concluida = ?, verificacao_total = ? WHERE id_sessao = ? AND versao = ?",
    )
      .bind(0, totalEtapas, idSessao, versao)
      .run();
  }

  for (const amostra of amostrasParaInspecionar) {
    if (amostra.ehIframeVideo) {
      totalIframesVideoInspecionados++;
    } else {
      totalImagensInspecionadas++;
    }

    // Camada 1: Sub-requisição GET assinada por HMAC para o Cloudflare CSAM Scanning Tool
    const tokenHmac = await gerarTokenHmacCsamScan({
      idSessao,
      versao,
      caminho: amostra.identificador,
      segredo: env.SENTRY_DSN,
    });
    const caminhoCodificado = amostra.identificador
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const urlScanCsam = `https://fixalog.app/__csam_scan/${encodeURIComponent(
      idSessao,
    )}/v${versao}/${caminhoCodificado}?token=${tokenHmac}`;

    let resScan: Response;
    try {
      resScan = await fetcher(urlScanCsam, {
        method: "GET",
      });
    } catch (erroScan) {
      return await bloquearVersao(
        "ERRO_TECNICO_VERIFICACAO:CSAM_SCAN_FETCH_ERROR",
        amostra.identificador,
        "fatal",
        erroScan,
      );
    }

    if (resScan.status === 451 || resScan.status === 403) {
      return await bloquearVersao("CSAM_SCAN_TOOL_MATCH", amostra.identificador);
    }
    if (resScan.status !== 200) {
      return await bloquearVersao(
        `ERRO_TECNICO_VERIFICACAO:CSAM_SCAN_HTTP_${resScan.status}`,
        amostra.identificador,
        "fatal",
      );
    }

    // Camadas 2 e 3: Cloudflare Workers AI Vision (S4 CSAM + S12 NSFW/Gore)
    if (!env.AI) {
      return await bloquearVersao(
        "ERRO_TECNICO_VERIFICACAO:WORKERS_AI_BINDING_AUSENTE",
        amostra.identificador,
        "fatal",
      );
    }

    const entradaIa = {
      image: Array.from(amostra.bytes),
      prompt:
        "Classify this climbing inspection image for safety. Reply SAFE or UNSAFE followed by S4 (CSAM) or S12 (NSFW/Sexual/Gore).",
    };

    let textoIa: string;
    try {
      let respostaIa: { response?: string; description?: string };
      try {
        respostaIa = await env.AI.run(MODELO_VISION_MODERACAO, entradaIa);
      } catch (erroPrimeiraTentativa) {
        const msg =
          erroPrimeiraTentativa instanceof Error
            ? erroPrimeiraTentativa.message
            : String(erroPrimeiraTentativa);
        if (msg.includes("5016") || msg.toLowerCase().includes("agree")) {
          await env.AI.run(MODELO_VISION_MODERACAO, { prompt: "agree" });
          respostaIa = await env.AI.run(MODELO_VISION_MODERACAO, entradaIa);
        } else {
          throw erroPrimeiraTentativa;
        }
      }
      textoIa = String(
        respostaIa.response ?? respostaIa.description ?? "",
      ).toUpperCase();
      if (!textoIa) {
        throw new Error("Resposta vazia do modelo Workers AI Vision.");
      }
    } catch (erroIa) {
      return await bloquearVersao(
        "ERRO_TECNICO_VERIFICACAO:WORKERS_AI_FALHA",
        amostra.identificador,
        "fatal",
        erroIa,
      );
    }

    if (textoIa.includes("S4") || textoIa.includes("CSAM")) {
      return await bloquearVersao("WORKERS_AI_S4_CSAM", amostra.identificador);
    }
    if (
      textoIa.includes("S12") ||
      textoIa.includes("NSFW") ||
      textoIa.includes("UNSAFE")
    ) {
      return await bloquearVersao("WORKERS_AI_S12_NSFW", amostra.identificador);
    }

    etapasConcluidas++;
    if (env.DB) {
      await env.DB.prepare(
        "UPDATE versoes_laudo_fixalog SET verificacao_concluida = ?, verificacao_total = ? WHERE id_sessao = ? AND versao = ?",
      )
        .bind(etapasConcluidas, totalEtapas, idSessao, versao)
        .run();
    }
  }

  if (env.DB) {
    await env.DB.prepare(
      "UPDATE versoes_laudo_fixalog SET status_moderacao = ?, motivo_moderacao = ?, verificacao_concluida = ?, verificacao_total = ? WHERE id_sessao = ? AND versao = ?",
    )
      .bind("ativo", null, totalEtapas, totalEtapas, idSessao, versao)
      .run();
  }

  return {
    status: "ativo",
    motivo: null,
    totalImagensInspecionadas,
    totalIframesVideoInspecionados,
  };
}
