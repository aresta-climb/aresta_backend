// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ROTA_VERIFICAR_SAUDE_FEEDBACK,
  URL_SERVIDOR_PADRAO,
} from "../../../aresta_api/openapi/generated/ts/feedback.ts";

/**
 * Interface com as variáveis de ambiente injetadas pelo Cloudflare Workers.
 */
export interface AmbienteFeedback {
  SUPABASE_STORAGE_URL?: string;
  SUPABASE_DASHBOARD_URL?: string;
}

/**
 * Interface mínima do contexto de execução do Cloudflare Workers para waitUntil.
 */
export interface ContextoExecucao {
  waitUntil(promessa: Promise<unknown>): void;
}

const URL_STORAGE_PADRAO = `${URL_SERVIDOR_PADRAO}/storage/v1/object/public/feedback_anexos`;
const URL_DASHBOARD_PADRAO =
  "https://supabase.com/dashboard/project/yzkhiaoqtxvvcyyuwmqg/editor/42715";

/**
 * 1 ano em segundos (365 dias). Padrão da RFC 7234 para cache "infinito" / imutável.
 */
const TTL_CACHE_SEGUNDOS = 31536000;

/**
 * Cabeçalhos CORS padrão para permitir visualização de imagens em qualquer contexto.
 */
export const cabecalhosCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Cabeçalho de cache "infinito" para anexos imutáveis associados ao UUID do feedback.
 * - public: permite cache em qualquer intermediário (CDN, proxy, browser).
 * - max-age=31536000: 1 ano no cache local do navegador.
 * - s-maxage=31536000: 1 ano no cache do Cloudflare CDN (Edge).
 * - immutable: diz ao navegador para nunca emitir requisições de revalidação (304).
 */
export const CABECALHO_CACHE_IMUTAVEL = `public, max-age=${TTL_CACHE_SEGUNDOS}, s-maxage=${TTL_CACHE_SEGUNDOS}, immutable`;

/**
 * Roteador principal do Worker de Feedback.
 *
 * Responsável por:
 * 1. Proxy transparente e com cache Edge dos anexos de feedback (/anexos/*).
 * 2. Redirecionamento canônico e desacoplado para a linha correspondente no Dashboard (/diagnostico/:id).
 * 3. Healthcheck de monitoramento operacional (/ e /health).
 */
export async function processarRequisicao(
  req: Request,
  env: AmbienteFeedback = {},
  ctx?: ContextoExecucao
): Promise<Response> {
  const url = new URL(req.url);
  const caminho = url.pathname;

  // Trata OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cabecalhosCors, status: 204 });
  }

  // Apenas GET e HEAD são suportados
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Método não permitido", {
      status: 405,
      headers: { ...cabecalhosCors, "Allow": "GET, HEAD, OPTIONS" },
    });
  }

  // 1. Rota de Saúde
  if (caminho === "/" || caminho === ROTA_VERIFICAR_SAUDE_FEEDBACK) {
    return new Response("Aresta Feedback Gateway operacional", {
      status: 200,
      headers: { ...cabecalhosCors, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // 2. Rota de Redirecionamento de Diagnóstico: /diagnostico/:id ou /diagnosticos/:id
  const matchDiagnostico = caminho.match(/^\/diagnosticos?\/([a-zA-Z0-9_-]+)/);
  if (matchDiagnostico) {
    const feedbackId = matchDiagnostico[1];
    const baseUrlDashboard = env.SUPABASE_DASHBOARD_URL || URL_DASHBOARD_PADRAO;
    const destinoDashboard = `${baseUrlDashboard}?filter=id%3Aeq%3A${feedbackId}`;

    return new Response(null, {
      status: 307, // Redirecionamento temporário preservando o método
      headers: {
        ...cabecalhosCors,
        Location: destinoDashboard,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  // 3. Rota de Anexos: /anexos/:feedbackId/:arquivo
  const matchAnexos = caminho.match(/^\/anexos\/(.+)$/);
  if (matchAnexos) {
    const caminhoAnexo = matchAnexos[1];
    const baseUrlStorage = env.SUPABASE_STORAGE_URL || URL_STORAGE_PADRAO;
    const urlOrigem = `${baseUrlStorage}/${caminhoAnexo}`;

    // Tenta obter do cache nativo do Cloudflare Edge (se disponível no ambiente)
    const cache =
      typeof (globalThis as any).caches !== "undefined"
        ? (globalThis as any).caches.default
        : null;

    if (cache && req.method === "GET") {
      try {
        const respostaCache = await cache.match(req);
        if (respostaCache) {
          return respostaCache;
        }
      } catch (_e) {
        // Falha silenciosa no cache local e segue para busca de origem
      }
    }

    try {
      // Subrequest com instrução explícita para o Cloudflare Edge Cache
      const respostaOrigem = await fetch(urlOrigem, {
        method: req.method,
        headers: {
          ...(req.headers.has("if-none-match")
            ? { "if-none-match": req.headers.get("if-none-match")! }
            : {}),
        },
        // Parâmetros especiais suportados pelo fetch do Cloudflare Workers
        ...({
          cf: {
            cacheTtl: TTL_CACHE_SEGUNDOS,
            cacheEverything: true,
          },
        } as any),
      });

      const cabecalhosResposta = new Headers(respostaOrigem.headers);
      cabecalhosResposta.set("Access-Control-Allow-Origin", "*");
      // Como os anexos são indexados pelo UUID imutável do feedback, aplicamos cache agressivo infinito
      cabecalhosResposta.set("Cache-Control", CABECALHO_CACHE_IMUTAVEL);

      const respostaFinal = new Response(respostaOrigem.body, {
        status: respostaOrigem.status,
        headers: cabecalhosResposta,
      });

      // Grava no Cloudflare Edge Cache para futuras requisições se for 200 OK
      if (cache && req.method === "GET" && respostaOrigem.status === 200) {
        ctx?.waitUntil?.(cache.put(req, respostaFinal.clone()));
      }

      return respostaFinal;
    } catch (e: any) {
      return new Response(
        `Erro ao buscar anexo no storage de origem: ${e?.message || e}`,
        {
          status: 502,
          headers: { ...cabecalhosCors, "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }
  }

  return new Response("Não encontrado", {
    status: 404,
    headers: { ...cabecalhosCors, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  fetch(
    req: Request,
    env: AmbienteFeedback,
    ctx: ContextoExecucao
  ): Promise<Response> {
    return processarRequisicao(req, env, ctx);
  },
};
