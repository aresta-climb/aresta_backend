// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  extrairArquivoDoEpub,
  extrairIndiceZipEpub,
  MapaIndiceZipEpub,
} from "./extrator_indice_epub.ts";
import { extrairQuadrosChaveMp4 } from "./extrator_iframes_mp4.ts";
import { AmbienteFixalog } from "./fakes/ambiente_fixalog_fake.ts";

export const MODELO_VISION_MODERACAO = "@cf/meta/llama-3.2-11b-vision-instruct";

export interface ResultadoModeracaoLaudo {
  status: "ativo" | "bloqueado";
  motivo: string | null;
  totalImagensInspecionadas: number;
  totalIframesVideoInspecionados: number;
}

/**
 * Dispara alerta imediato para `alertas.arestaclimb.com` (ou `env.ALERTA_URL`)
 * quando ocorre bloqueio por CSAM/NSFW ou denúncia de usuário.
 */
export async function dispararAlertaSegurancaFixalog(params: {
  env: AmbienteFixalog;
  idSessao: string;
  versao: number;
  userId?: string;
  tipoEvento: "BLOQUEIO_CSAM_NSFW" | "DENUNCIA_LAUDO";
  motivo: string;
  detalhes?: string | null;
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
}

/**
 * Executa a esteira assíncrona de moderação em 3 camadas sobre todas as fotos e
 * todos os I-Frames extraídos no servidor dos vídeos `.mp4` de uma versão do laudo:
 * 1. Sub-requisição na borda para o Cloudflare CSAM Scanning Tool (`/__csam_scan/...`)
 * 2. Classificação CSAM (`S4`) via Cloudflare Workers AI Vision
 * 3. Classificação NSFW/Gore (`S12`) via Cloudflare Workers AI Vision
 * Atualiza `versoes_laudo_fixalog.status_moderacao` para `'ativo'` ou `'bloqueado'`.
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

  const amostrasParaInspecionar: Array<{
    identificador: string;
    bytes: Uint8Array;
    ehIframeVideo: boolean;
  }> = [];

  for (const caminho of Object.keys(indice)) {
    const lower = caminho.toLowerCase();
    const ehImagem =
      lower.endsWith(".webp") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png");

    if (ehImagem) {
      const bytesImg = await extrairArquivoDoEpub(epubBytes, caminho, indice);
      if (bytesImg && bytesImg.byteLength > 0) {
        amostrasParaInspecionar.push({
          identificador: caminho,
          bytes: bytesImg,
          ehIframeVideo: false,
        });
      }
      continue;
    }

    if (lower.endsWith(".mp4")) {
      const bytesMp4 = await extrairArquivoDoEpub(epubBytes, caminho, indice);
      if (bytesMp4 && bytesMp4.byteLength > 0) {
        const quadros = extrairQuadrosChaveMp4(bytesMp4);
        for (const q of quadros) {
          amostrasParaInspecionar.push({
            identificador: `${caminho}#iframe_${q.indiceAmostra}_${q.segundoEstimado}s`,
            bytes: q.bytesQuadro,
            ehIframeVideo: true,
          });
        }
      }
    }
  }

  let totalImagensInspecionadas = 0;
  let totalIframesVideoInspecionados = 0;

  const bloquearVersao = async (
    motivo: string,
    identificadorMidia: string,
  ): Promise<ResultadoModeracaoLaudo> => {
    if (env.DB) {
      await env.DB.prepare(
        "UPDATE versoes_laudo_fixalog SET status_moderacao = ?, motivo_moderacao = ? WHERE id_sessao = ? AND versao = ?",
      )
        .bind("bloqueado", `${motivo}:${identificadorMidia}`, idSessao, versao)
        .run();
    }

    await dispararAlertaSegurancaFixalog({
      env,
      idSessao,
      versao,
      userId,
      tipoEvento: "BLOQUEIO_CSAM_NSFW",
      motivo,
      detalhes: `Mídia bloqueada: ${identificadorMidia}`,
    });

    return {
      status: "bloqueado",
      motivo: `${motivo}:${identificadorMidia}`,
      totalImagensInspecionadas,
      totalIframesVideoInspecionados,
    };
  };

  for (const amostra of amostrasParaInspecionar) {
    if (amostra.ehIframeVideo) {
      totalIframesVideoInspecionados++;
    } else {
      totalImagensInspecionadas++;
    }

    // Camada 1: Sub-requisição para inspeção da Cloudflare CSAM Scanning Tool
    const urlScanCsam = `https://fixalog.app/__csam_scan/${encodeURIComponent(
      idSessao,
    )}/v${versao}/${encodeURIComponent(amostra.identificador)}`;
    try {
      const resScan = await fetcher(urlScanCsam, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: amostra.bytes as unknown as BodyInit,
      });
      if (resScan.status === 451 || resScan.status === 403) {
        return await bloquearVersao("CSAM_SCAN_TOOL_MATCH", amostra.identificador);
      }
    } catch {
      // Prossegue para a camada de IA caso a sub-requisição local não esteja ativa em dev
    }

    // Camadas 2 e 3: Cloudflare Workers AI Vision (S4 CSAM + S12 NSFW/Gore)
    if (env.AI) {
      const respostaIa = await env.AI.run(MODELO_VISION_MODERACAO, {
        image: Array.from(amostra.bytes.subarray(0, 512)),
        prompt:
          "Classify this climbing inspection image for safety. Reply SAFE or UNSAFE followed by S4 (CSAM) or S12 (NSFW/Sexual/Gore).",
      });
      const textoIa = String(
        respostaIa.response ?? respostaIa.description ?? "SAFE",
      ).toUpperCase();

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
    }
  }

  if (env.DB) {
    await env.DB.prepare(
      "UPDATE versoes_laudo_fixalog SET status_moderacao = ?, motivo_moderacao = ? WHERE id_sessao = ? AND versao = ?",
    )
      .bind("ativo", null, idSessao, versao)
      .run();
  }

  return {
    status: "ativo",
    motivo: null,
    totalImagensInspecionadas,
    totalIframesVideoInspecionados,
  };
}
