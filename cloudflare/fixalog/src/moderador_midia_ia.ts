// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  extrairArquivoDoEpub,
  extrairIndiceZipEpub,
  MapaIndiceZipEpub,
} from "./extrator_indice_epub.ts";
import { relatarErroSentry } from "../../../supabase/functions/compartilhado/relator_sentry.ts";
import {
  AmbienteFixalog,
  CacheBordaFixalog,
} from "./fakes/ambiente_fixalog_fake.ts";

export const MODELO_VISION_MODERACAO = "@cf/meta/llama-3.2-11b-vision-instruct";

const falhasTecnicasPendentesNotificacao = new Set<string>();
const moderacoesEmExecucaoTimestamp = new Map<string, number>();

function chaveSessaoVersao(idSessao: string, versao: number): string {
  return `${idSessao}#v${versao}`;
}

/**
 * Registra um heartbeat em memória indicando que a moderação de `{idSessao, versao}`
 * está ativamente em execução neste Isolate do Worker.
 */
export function registrarHeartbeatModeracaoEmExecucao(
  idSessao: string,
  versao: number,
  timestampMs = Date.now(),
): void {
  moderacoesEmExecucaoTimestamp.set(
    chaveSessaoVersao(idSessao, versao),
    timestampMs,
  );
}

/**
 * Remove o registro de execução em memória ao concluir ou interromper a moderação.
 */
export function encerrarHeartbeatModeracaoEmExecucao(
  idSessao: string,
  versao: number,
): void {
  moderacoesEmExecucaoTimestamp.delete(chaveSessaoVersao(idSessao, versao));
}

/**
 * Verifica se há uma moderação ativa neste Isolate que progrediu nos últimos `limiteInatividadeMs`
 * (20s por padrão — abaixo do limite de 30s do `ctx.waitUntil` do Cloudflare Workers).
 */
export function moderacaoEstaAtivaRecentemente(
  idSessao: string,
  versao: number,
  limiteInatividadeMs = 20_000,
): boolean {
  const ultimo = moderacoesEmExecucaoTimestamp.get(
    chaveSessaoVersao(idSessao, versao),
  );
  if (ultimo === undefined) {
    return false;
  }
  return Date.now() - ultimo < limiteInatividadeMs;
}

/**
 * Registra que uma versão de laudo acabou de sofrer falha técnica de verificação,
 * garantindo que o próximo polling de `GET /status` receba a falha uma vez antes
 * de habilitar o reprocessamento automático em novas tentativas do usuário.
 */
export function registrarFalhaTecnicaRecente(
  idSessao: string,
  versao: number,
): void {
  falhasTecnicasPendentesNotificacao.add(chaveSessaoVersao(idSessao, versao));
}

/**
 * Consome a notificação pendente de falha técnica recente para `{idSessao, versao}`.
 * Retorna `true` na primeira consulta imediatamente após a falha e `false` nas seguintes.
 */
export function consumirNotificacaoFalhaTecnicaRecente(
  idSessao: string,
  versao: number,
): boolean {
  const chave = chaveSessaoVersao(idSessao, versao);
  if (falhasTecnicasPendentesNotificacao.has(chave)) {
    falhasTecnicasPendentesNotificacao.delete(chave);
    return true;
  }
  return false;
}

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

export interface InterpretacaoModeracaoVision {
  veredito: "SAFE" | "S4_CSAM" | "S12_NSFW";
  reasoning: string | null;
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
  reasoningIa?: string | null;
  nivel?: "error" | "fatal";
  erroOriginal?: unknown;
}): Promise<void> {
  const url =
    params.env.ALERTA_URL ?? "https://alertas.arestaclimb.com/api/v1/alertas";
  const fetcher = params.env.fetchExterno ?? fetch;

  if (params.env.SENTRY_DSN) {
    const sufixoErro =
      params.erroOriginal instanceof Error
        ? ` — ${params.erroOriginal.message}`
        : "";
    const sufixoDetalhes = params.detalhes ? ` (${params.detalhes})` : "";
    const erroRelato = new Error(
      `[${params.tipoEvento}] Laudo ${params.idSessao} (v${params.versao}): ${params.motivo}${sufixoDetalhes}${sufixoErro}`,
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
        reasoning_ia: params.reasoningIa ?? null,
      },
      fetchFn: fetcher as typeof fetch,
    });
  }

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
        reasoning_ia: params.reasoningIa ?? null,
        ocorrido_em: new Date().toISOString(),
      }),
    });
  } catch {
    // Não interrompe a transição de estado no D1 caso o webhook externo falhe
  }
}

/**
 * Extrai o `veredito` e o `reasoning` da resposta do modelo Llama 3.2 Vision priorizando
 * o formato JSON estruturado `{"reasoning": "...", "verdict": "SAFE" | "UNSAFE_S4" | "UNSAFE_S12"}`
 * (onde o campo `reasoning` é completamente ignorado na tomada de decisão, mas preservado para
 * diagnóstico em alertas/issues do Sentry quando ocorre bloqueio UNSAFE).
 */
export function interpretarRespostaModeracaoVision(
  textoBruto: string,
): InterpretacaoModeracaoVision {
  let reasoningExtraido: string | null = null;
  const inicioJson = textoBruto.indexOf("{");
  const fimJson = textoBruto.lastIndexOf("}");
  if (inicioJson >= 0 && fimJson > inicioJson) {
    try {
      const parsed = JSON.parse(
        textoBruto.slice(inicioJson, fimJson + 1),
      ) as Record<string, unknown>;
      const reasoningBruto = String(
        parsed.reasoning ?? parsed.reason ?? parsed.explanation ?? "",
      ).trim();
      reasoningExtraido = reasoningBruto || null;

      const vereditoJson = String(
        parsed.verdict ??
          parsed.veredito ??
          parsed.classification ??
          parsed.status ??
          "",
      )
        .trim()
        .toUpperCase();
      if (vereditoJson) {
        if (vereditoJson === "SAFE") {
          return { veredito: "SAFE", reasoning: reasoningExtraido };
        }
        if (vereditoJson.includes("S4") || vereditoJson.includes("CSAM")) {
          return { veredito: "S4_CSAM", reasoning: reasoningExtraido };
        }
        if (
          vereditoJson.includes("S12") ||
          vereditoJson.includes("NSFW") ||
          vereditoJson.includes("UNSAFE")
        ) {
          return { veredito: "S12_NSFW", reasoning: reasoningExtraido };
        }
      }
    } catch {
      // Se o JSON estiver truncado ou malformado, prossegue para o fallback textual abaixo
    }
  }

  const reasoningFallback = reasoningExtraido ?? (textoBruto.trim() || null);
  const normalizado = textoBruto
    .replace(/[*_`~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  // Em regex, \bSAFE\b exige fronteira de palavra antes do S, portanto NUNCA casa com UNSAFE.
  // Se o modelo declarou a palavra isolada SAFE sem negá-la ("NOT SAFE") e sem veredito explícito UNSAFE, é SAFE.
  const contemPalavraSafeIsolada = /\bSAFE\b/.test(normalizado);
  const safeFoiNegado =
    /\b(?:NOT|NO|NEVER|ISN'T|AREN'T|NEITHER)\s+(?:CONSIDERED\s+|CLASSIFIED\s+AS\s+)?SAFE\b/.test(
      normalizado,
    );
  const vereditoExplicitoUnsafe =
    /^UNSAFE\b/.test(normalizado) ||
    /\b(?:IS|ARE|VERDICT|CLASSIFICATION|RESULT|STATUS)\s*[:=-]?\s*UNSAFE\b/.test(
      normalizado,
    );

  if (contemPalavraSafeIsolada && !safeFoiNegado && !vereditoExplicitoUnsafe) {
    return { veredito: "SAFE", reasoning: reasoningFallback };
  }

  const semNegacoes = normalizado.replace(
    /\b(?:NOT|NO|WITHOUT|FREE OF|DOES NOT CONTAIN|DOESN'T CONTAIN|NEITHER|NOR)\s+(?:ANY\s+)?(?:SEVERE\s+VIOLATIONS\s+(?:LIKE|SUCH AS)\s+)?(?:UNSAFE|S4|CSAM|S12|NSFW|SEXUAL|GORE)(?:\s*(?:,|OR|NOR|\(|\))\s*(?:UNSAFE|S4|CSAM|S12|NSFW|SEXUAL|GORE))*\b/g,
    " ",
  );

  const contemUnsafe = /\bUNSAFE\b/.test(semNegacoes);
  const contemS4 = /\b(?:S4|CSAM)\b/.test(semNegacoes);
  const contemS12 = /\b(?:S12|NSFW)\b/.test(semNegacoes);

  if (contemS4) {
    return { veredito: "S4_CSAM", reasoning: reasoningFallback };
  }
  if (contemS12 || contemUnsafe) {
    return { veredito: "S12_NSFW", reasoning: reasoningFallback };
  }

  return { veredito: "SAFE", reasoning: reasoningFallback };
}

/**
 * Analisa a resposta do modelo Llama 3.2 Vision retornando apenas o veredito de classificação.
 */
export function classificarRespostaModeracaoVision(
  textoBruto: string,
): "SAFE" | "S4_CSAM" | "S12_NSFW" {
  return interpretarRespostaModeracaoVision(textoBruto).veredito;
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
  etapaInicial?: number;
}): Promise<ResultadoModeracaoLaudo> {
  const { env, idSessao, versao, userId, epubBytes } = params;
  registrarHeartbeatModeracaoEmExecucao(idSessao, versao);
  try {
    return await _executarModeracaoAssincronaLaudoInterno(params);
  } finally {
    encerrarHeartbeatModeracaoEmExecucao(idSessao, versao);
  }
}

async function _executarModeracaoAssincronaLaudoInterno(params: {
  env: AmbienteFixalog;
  idSessao: string;
  versao: number;
  userId: string;
  epubBytes: Uint8Array;
  indicePreCalculado?: MapaIndiceZipEpub;
  etapaInicial?: number;
}): Promise<ResultadoModeracaoLaudo> {
  const { env, idSessao, versao, userId, epubBytes } = params;
  const indice = params.indicePreCalculado ?? extrairIndiceZipEpub(epubBytes);
  const cacheBorda: CacheBordaFixalog | null =
    env.cacheBorda ??
    (
      globalThis as unknown as {
        caches?: { default?: CacheBordaFixalog };
      }
    ).caches?.default ??
    null;
  const urlsCsamCacheBorda: string[] = [];

  let totalImagensInspecionadas = 0;
  let totalIframesVideoInspecionados = 0;
  let totalEtapas = 1;
  let etapasConcluidas = 0;

  const bloquearVersao = async (
    motivo: string,
    identificadorMidia: string,
    nivel: "error" | "fatal" = "error",
    erroOriginal?: unknown,
    reasoningIa?: string | null,
  ): Promise<ResultadoModeracaoLaudo> => {
    if (motivo.startsWith("ERRO_TECNICO_VERIFICACAO:")) {
      registrarFalhaTecnicaRecente(idSessao, versao);
    }
    if (cacheBorda && urlsCsamCacheBorda.length > 0) {
      await Promise.all(
        urlsCsamCacheBorda.map((u) => cacheBorda.delete(u).catch(() => false)),
      );
    }
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
      detalhes: reasoningIa
        ? `Mídia bloqueada: ${identificadorMidia} | Reasoning IA: ${reasoningIa}`
        : `Mídia bloqueada: ${identificadorMidia}`,
      reasoningIa,
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
  etapasConcluidas = Math.min(
    Math.max(0, params.etapaInicial ?? 0),
    amostrasParaInspecionar.length,
  );

  for (let i = 0; i < etapasConcluidas; i++) {
    if (amostrasParaInspecionar[i].ehIframeVideo) {
      totalIframesVideoInspecionados++;
    } else {
      totalImagensInspecionadas++;
    }
  }

  if (env.DB) {
    await env.DB.prepare(
      "UPDATE versoes_laudo_fixalog SET verificacao_concluida = ?, verificacao_total = ? WHERE id_sessao = ? AND versao = ?",
    )
      .bind(etapasConcluidas, totalEtapas, idSessao, versao)
      .run();
  }

  for (const amostra of amostrasParaInspecionar.slice(etapasConcluidas)) {
    registrarHeartbeatModeracaoEmExecucao(idSessao, versao);
    if (amostra.ehIframeVideo) {
      totalIframesVideoInspecionados++;
    } else {
      totalImagensInspecionadas++;
    }

    // Camada 1: Inspeção pelo Cloudflare CSAM Scanning Tool na borda da zona fixalog.app
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

    if (env.fetchExterno) {
      let resScan: Response;
      try {
        resScan = await env.fetchExterno(urlScanCsam, {
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
        return await bloquearVersao(
          "CSAM_SCAN_TOOL_MATCH",
          amostra.identificador,
        );
      }
      if (resScan.status !== 200) {
        return await bloquearVersao(
          `ERRO_TECNICO_VERIFICACAO:CSAM_SCAN_HTTP_${resScan.status}`,
          amostra.identificador,
          "fatal",
        );
      }
    } else if (cacheBorda) {
      // Em produção no Cloudflare Workers (zona Worker-only sem servidor de origem DNS),
      // chamadas fetch() para a própria zona fixalog.app sofrem bypass do Worker e falham com HTTP 522.
      // O CSAM Scanning Tool da Cloudflare opera diretamente sobre objetos de imagem no Cache de Borda.
      const mimeTypeAmostra =
        indice[amostra.identificador]?.mimeType ??
        (amostra.identificador.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : amostra.identificador.toLowerCase().endsWith(".png")
          ? "image/png"
          : "image/jpeg");
      try {
        await cacheBorda.put(
          urlScanCsam,
          new Response(new Uint8Array(amostra.bytes), {
            status: 200,
            headers: {
              "Content-Type": mimeTypeAmostra,
              "Content-Length": String(amostra.bytes.byteLength),
              "Cache-Control": "public, max-age=3600",
            },
          }),
        );
        urlsCsamCacheBorda.push(urlScanCsam);
        const inspecaoBorda = await cacheBorda.match(urlScanCsam);
        if (
          inspecaoBorda &&
          (inspecaoBorda.status === 451 || inspecaoBorda.status === 403)
        ) {
          return await bloquearVersao(
            "CSAM_SCAN_TOOL_MATCH",
            amostra.identificador,
          );
        }
      } catch (erroCache) {
        return await bloquearVersao(
          "ERRO_TECNICO_VERIFICACAO:CSAM_SCAN_CACHE_ERROR",
          amostra.identificador,
          "fatal",
          erroCache,
        );
      }
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
        'You are a strict content safety classifier for a technical engineering and rock climbing inspection app. Photos of tools, saw blades, hardware, bolts, climbing gear, hands holding equipment, technical documents, PDFs, invoices, certificates, tables, and text pages are completely SAFE. Only classify as UNSAFE_S4 if the image depicts real child sexual abuse material (CSAM), or UNSAFE_S12 if it depicts explicit pornography or extreme gore. Respond ONLY with a valid JSON object in this exact format: {"reasoning":"<brief 1-sentence description of what is visible>","verdict":"SAFE"} where "verdict" MUST be one of "SAFE", "UNSAFE_S4", or "UNSAFE_S12".',
    };

    let textoIa: string;
    try {
      let respostaIa: { response?: unknown; description?: unknown };
      try {
        respostaIa = await env.AI.run(MODELO_VISION_MODERACAO, entradaIa);
      } catch (erroPrimeiraTentativa) {
        const msg =
          erroPrimeiraTentativa instanceof Error
            ? erroPrimeiraTentativa.message
            : String(erroPrimeiraTentativa);
        if (msg.includes("5016") || msg.toLowerCase().includes("agree")) {
          try {
            await env.AI.run(MODELO_VISION_MODERACAO, { prompt: "agree" });
          } catch (erroAgree) {
            const msgAgree =
              erroAgree instanceof Error
                ? erroAgree.message
                : String(erroAgree);
            if (
              !msgAgree.includes("5016") &&
              !msgAgree.toLowerCase().includes("agree")
            ) {
              throw erroAgree;
            }
          }
          respostaIa = await env.AI.run(MODELO_VISION_MODERACAO, entradaIa);
        } else {
          throw erroPrimeiraTentativa;
        }
      }
      const bruto = respostaIa.response ?? respostaIa.description ?? "";
      textoIa =
        typeof bruto === "object" && bruto !== null
          ? JSON.stringify(bruto)
          : String(bruto).trim();
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

    const interpretacaoIa = interpretarRespostaModeracaoVision(textoIa);
    if (interpretacaoIa.veredito === "S4_CSAM") {
      return await bloquearVersao(
        "WORKERS_AI_S4_CSAM",
        amostra.identificador,
        "error",
        undefined,
        interpretacaoIa.reasoning,
      );
    }
    if (interpretacaoIa.veredito === "S12_NSFW") {
      return await bloquearVersao(
        "WORKERS_AI_S12_NSFW",
        amostra.identificador,
        "error",
        undefined,
        interpretacaoIa.reasoning,
      );
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
