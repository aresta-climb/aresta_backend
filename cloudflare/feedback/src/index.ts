// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

/**
 * Interface com as variáveis de ambiente injetadas pelo Cloudflare Workers.
 */
export interface AmbienteFeedback {
  SUPABASE_STORAGE_URL?: string;
  SUPABASE_DASHBOARD_URL?: string;
}

const URL_STORAGE_PADRAO =
  "https://yzkhiaoqtxvvcyyuwmqg.supabase.co/storage/v1/object/public/feedback_anexos";
const URL_DASHBOARD_PADRAO =
  "https://supabase.com/dashboard/project/yzkhiaoqtxvvcyyuwmqg/editor/42715";

/**
 * Cabeçalhos CORS padrão para permitir visualização de imagens em qualquer contexto.
 */
export const cabecalhosCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
  env: AmbienteFeedback = {}
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
  if (caminho === "/" || caminho === "/health") {
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

    try {
      const respostaOrigem = await fetch(urlOrigem, {
        method: req.method,
        headers: {
          ...(req.headers.has("if-none-match")
            ? { "if-none-match": req.headers.get("if-none-match")! }
            : {}),
        },
      });

      const cabecalhosResposta = new Headers(respostaOrigem.headers);
      cabecalhosResposta.set("Access-Control-Allow-Origin", "*");
      // Como os anexos são indexados pelo UUID imutável do feedback, aplicamos cache agressivo
      cabecalhosResposta.set(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );

      return new Response(respostaOrigem.body, {
        status: respostaOrigem.status,
        headers: cabecalhosResposta,
      });
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
  fetch(req: Request, env: AmbienteFeedback): Promise<Response> {
    return processarRequisicao(req, env);
  },
};
