// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

/**
 * Cloudflare Worker: Roteador Central de Alertas Operacionais (`aresta-alertas-worker`)
 *
 * Responsabilidades:
 * 1. Receber e validar criptograficamente (HMAC-SHA256) webhooks do Sentry (`/webhook/sentry`)
 *    e da organização GitHub `aresta-climb` (`/webhook/github`).
 * 2. Classificar a severidade operacional em dois grupos da Comunidade no WhatsApp:
 *    - 🚨 Grupo 1 (Emergências): Crashes fatais (`level: fatal`), Spikes de erro (`metric_alert`),
 *      quedas de Uptime e falhas de GitHub Actions (`workflow_run` com `conclusion === "failure"`
 *      na branch `main` ou tags `v*`, incluindo deploys do `aresta_db`).
 *    - 🛠️ Grupo 2 (Bugs & Feedbacks): Abertura de novas GitHub Issues (`issues.opened`, incluindo
 *      issues criadas pelo Sentry *First Seen* com extração do link de investigação e issues de
 *      feedback comunitário) e novos Pull Requests (`pull_request.opened`).
 * 3. Entregar a mensagem via gateway WAHA (`POST /api/sendText`) hospedado em VM `e2-micro`
 *    no Google Cloud exposta via Cloudflare Tunnel.
 * 4. Acionar fallback automático de e-mail via API do Resend (`alerta@login.arestaclimb.com` ->
 *    `contato@arestaclimb.com`) exclusivamente quando o envio ao WAHA falhar, sem gerar loops
 *    recursivos no Sentry.
 */

import {
  InterfaceClienteResend,
  InterfaceClienteWaha,
  OpcoesEnvioResend,
  OpcoesEnvioWaha,
  ResultadoEnvioResend,
  ResultadoEnvioWaha,
} from "./cliente_notificacao_fake.ts";

export interface AmbienteAlertas {
  WAHA_BASE_URL: string;
  WAHA_API_KEY: string;
  WAHA_SESSION?: string;
  WHATSAPP_GRUPO_EMERGENCIAS_ID: string;
  WHATSAPP_GRUPO_BUGS_ID: string;
  SENTRY_WEBHOOK_SECRET: string;
  GITHUB_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  EMAIL_REMETENTE_ALERTA?: string;
  EMAIL_DESTINATARIO_FALLBACK?: string;
  clienteWaha?: InterfaceClienteWaha;
  clienteResend?: InterfaceClienteResend;
}

const CABECALHOS_PADRAO: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, sentry-hook-signature, sentry-hook-resource, x-hub-signature-256, x-github-event",
};

/**
 * Implementação HTTP real do cliente WAHA (`POST /api/sendText`).
 */
export class ClienteWahaHttp implements InterfaceClienteWaha {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async enviarMensagemGrupo(opcoes: OpcoesEnvioWaha): Promise<ResultadoEnvioWaha> {
    const baseLimpa = opcoes.urlBase.replace(/\/+$/, "");
    const url = `${baseLimpa}/api/sendText`;

    try {
      const resposta = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": opcoes.chaveApi,
        },
        body: JSON.stringify({
          session: opcoes.sessao || "default",
          chatId: opcoes.chatId,
          text: opcoes.texto,
        }),
      });

      if (!resposta.ok) {
        const detalhe = await resposta.text();
        return {
          sucesso: false,
          statusHttp: resposta.status,
          erro: `HTTP ${resposta.status}: ${detalhe}`,
        };
      }

      return {
        sucesso: true,
        statusHttp: resposta.status,
      };
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return {
        sucesso: false,
        statusHttp: 0,
        erro: msg,
      };
    }
  }
}

/**
 * Implementação HTTP real do cliente Resend (`POST https://api.resend.com/emails`).
 */
export class ClienteResendHttp implements InterfaceClienteResend {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async enviarEmailFallback(opcoes: OpcoesEnvioResend): Promise<ResultadoEnvioResend> {
    try {
      const textoCompleto = [
        "⚠️ AVISO DE CONTINGÊNCIA: O gateway do WhatsApp (WAHA) falhou ao entregar este alerta.",
        `Motivo da falha no WAHA: ${opcoes.motivoFalhaWaha}`,
        "------------------------------------------------------------",
        "",
        opcoes.texto,
      ].join("\n");

      const resposta = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${opcoes.chaveApi}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Aresta Alertas <${opcoes.remetente}>`,
          to: [opcoes.destinatario],
          subject: opcoes.assunto,
          text: textoCompleto,
        }),
      });

      return {
        sucesso: resposta.ok,
        statusHttp: resposta.status,
      };
    } catch {
      return {
        sucesso: false,
        statusHttp: 0,
      };
    }
  }
}

/**
 * Calcula a assinatura HMAC-SHA256 em hexadecimal para validação de webhooks.
 */
export async function assinarHmacSha256Hex(
  segredo: string,
  corpoBruto: string,
): Promise<string> {
  const codificador = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    codificador.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinaturaBuffer = await crypto.subtle.sign(
    "HMAC",
    chave,
    codificador.encode(corpoBruto),
  );
  return Array.from(new Uint8Array(assinaturaBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compara duas strings em tempo constante para mitigar ataques de timing.
 */
function compararTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

interface NotificacaoClassificada {
  grupoId: string;
  assuntoFallback: string;
  texto: string;
}

/**
 * Classifica e formata um webhook do Sentry para envio apenas se for Emergência
 * (Crash Fatal, Spike de Metric Alert ou Queda de Uptime).
 */
function classificarWebhookSentry(
  recurso: string,
  payload: Record<string, any>,
  env: AmbienteAlertas,
): NotificacaoClassificada | null {
  const acao = String(payload?.action || "");

  // 1. Spike ou Alerta de Métrica / Uptime
  if (recurso === "metric_alert" && (acao === "critical" || acao === "warning" || acao === "triggered")) {
    const dados = payload?.data || {};
    const titulo = dados.description_title || "Alerta Crítico de Métrica / Spike";
    const detalhe = dados.description_text || "Anomalia de volume de erros ou latência detectada.";
    const url = dados.web_url || "https://aresta-climb.sentry.io/alerts/";

    return {
      grupoId: env.WHATSAPP_GRUPO_EMERGENCIAS_ID,
      assuntoFallback: `[CONTINGÊNCIA WHATSAPP] 🚨 ${titulo}`,
      texto: [
        "🚨 *EMERGÊNCIA — SPIKE / MONITOR SENTRY*",
        `• *Alerta:* ${titulo}`,
        `• *Detalhe:* ${detalhe}`,
        `• *Painel Sentry:* ${url}`,
      ].join("\n"),
    };
  }

  // 2. Crash Fatal ou Evento de Emergência
  const evento = payload?.data?.event;
  if (evento && (evento.level === "fatal" || acao === "triggered")) {
    const titulo = evento.title || "Exceção Fatal em Produção";
    const url = evento.web_url || "https://aresta-climb.sentry.io/issues/";
    const tagsLista: Array<[string, string]> = Array.isArray(evento.tags) ? evento.tags : [];
    const servicoTag = tagsLista.find((t) => t[0] === "service")?.[1] || "ecossistema-aresta";

    return {
      grupoId: env.WHATSAPP_GRUPO_EMERGENCIAS_ID,
      assuntoFallback: `[CONTINGÊNCIA WHATSAPP] 🚨 Crash Fatal em ${servicoTag}`,
      texto: [
        "🚨 *EMERGÊNCIA — CRASH FATAL DETECTADO*",
        `• *Serviço:* \`${servicoTag}\``,
        `• *Erro:* ${titulo}`,
        `• *Investigação Sentry:* ${url}`,
      ].join("\n"),
    };
  }

  return null;
}

/**
 * Extrai eventual link de Issue do Sentry presente no corpo de uma GitHub Issue.
 */
function extrairLinkSentryDoCorpo(corpoIssue: string): string | null {
  const match = corpoIssue.match(/https:\/\/[a-zA-Z0-9.-]*sentry\.io\/issues\/[0-9]+\/?/);
  return match ? match[0] : null;
}

/**
 * Classifica e formata um webhook organizacional do GitHub (`workflow_run`, `issues`, `pull_request`).
 */
function classificarWebhookGithub(
  eventoGithub: string,
  payload: Record<string, any>,
  env: AmbienteAlertas,
): NotificacaoClassificada | null {
  const acao = String(payload?.action || "");
  const repositorio = payload?.repository?.full_name || "aresta-climb";

  // 1. Falha de CI / Deploy em main ou tag de release -> Grupo 1 (Emergências)
  if (eventoGithub === "workflow_run" && acao === "completed") {
    const execucao = payload?.workflow_run;
    const conclusao = execucao?.conclusion;
    const branch = String(execucao?.head_branch || "");
    const ehBranchCritica = branch === "main" || branch.startsWith("v");

    if (conclusao === "failure" && ehBranchCritica) {
      const nomeWorkflow = execucao?.name || "Pipeline CI/CD";
      const urlRun = execucao?.html_url || "";
      const commitMsg = String(execucao?.head_commit?.message || "").split("\n")[0];
      const autor = execucao?.head_commit?.author?.name || "N/A";

      return {
        grupoId: env.WHATSAPP_GRUPO_EMERGENCIAS_ID,
        assuntoFallback: `[CONTINGÊNCIA WHATSAPP] 🚨 Falha de Deploy/CI em ${repositorio}`,
        texto: [
          "🚨 *EMERGÊNCIA — FALHA DE DEPLOY / CI*",
          `• *Repositório:* \`${repositorio}\``,
          `• *Workflow:* ${nomeWorkflow} (\`${branch}\`)`,
          `• *Commit:* ${commitMsg} (${autor})`,
          `• *Logs da Execução:* ${urlRun}`,
        ].join("\n"),
      };
    }
    return null;
  }

  // 2. Nova Issue aberta (Sentry First Seen, Feedback do App ou Comunidade) -> Grupo 2 (Bugs & Feedbacks)
  if (eventoGithub === "issues" && acao === "opened") {
    const issue = payload?.issue;
    const numero = issue?.number;
    const titulo = issue?.title || "Nova Issue";
    const urlIssue = issue?.html_url || "";
    const corpo = String(issue?.body || "");
    const linkSentry = extrairLinkSentryDoCorpo(corpo);

    const linhas = [
      linkSentry
        ? "🐛 *NOVO ERRO INÉDITO (SENTRY -> GITHUB)*"
        : "🛠️ *NOVA ISSUE / FEEDBACK REGISTRADO*",
      `• *Repositório:* \`${repositorio}\` (#${numero})`,
      `• *Título:* ${titulo}`,
      `• *GitHub Issue:* ${urlIssue}`,
    ];

    if (linkSentry) {
      linhas.push(`• *Detalhes no Sentry:* ${linkSentry}`);
    }

    return {
      grupoId: env.WHATSAPP_GRUPO_BUGS_ID,
      assuntoFallback: `[CONTINGÊNCIA WHATSAPP] 🛠️ Nova Issue #${numero} em ${repositorio}`,
      texto: linhas.join("\n"),
    };
  }

  // 3. Novo Pull Request aberto -> Grupo 2 (Bugs & Feedbacks)
  if (eventoGithub === "pull_request" && acao === "opened") {
    const pr = payload?.pull_request;
    const numero = pr?.number;
    const titulo = pr?.title || "Novo Pull Request";
    const urlPr = pr?.html_url || "";
    const autor = pr?.user?.login || "colaborador";

    return {
      grupoId: env.WHATSAPP_GRUPO_BUGS_ID,
      assuntoFallback: `[CONTINGÊNCIA WHATSAPP] 🔀 Novo PR #${numero} em ${repositorio}`,
      texto: [
        "🔀 *NOVO PULL REQUEST ABERTO*",
        `• *Repositório:* \`${repositorio}\` (#${numero})`,
        `• *Título:* ${titulo}`,
        `• *Autor:* \`${autor}\``,
        `• *Revisar PR:* ${urlPr}`,
      ].join("\n"),
    };
  }

  return null;
}

/**
 * Entrega a notificação via WAHA e, em caso de falha, aciona o fallback por e-mail via Resend.
 */
async function despacharNotificacaoComFallback(
  notificacao: NotificacaoClassificada,
  env: AmbienteAlertas,
): Promise<Response> {
  const clienteWaha = env.clienteWaha || new ClienteWahaHttp();
  const resultadoWaha = await clienteWaha.enviarMensagemGrupo({
    urlBase: env.WAHA_BASE_URL,
    chaveApi: env.WAHA_API_KEY,
    chatId: notificacao.grupoId,
    texto: notificacao.texto,
    sessao: env.WAHA_SESSION,
  });

  if (resultadoWaha.sucesso) {
    return new Response(
      JSON.stringify({ ok: true, entregueVia: "whatsapp_waha" }),
      {
        status: 200,
        headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
      },
    );
  }

  // Fallback exclusivo via Resend quando o WAHA falha
  const clienteResend = env.clienteResend || new ClienteResendHttp();
  const motivoFalha = resultadoWaha.erro || `Status HTTP ${resultadoWaha.statusHttp}`;
  await clienteResend.enviarEmailFallback({
    chaveApi: env.RESEND_API_KEY,
    remetente: env.EMAIL_REMETENTE_ALERTA || "alerta@login.arestaclimb.com",
    destinatario: env.EMAIL_DESTINATARIO_FALLBACK || "contato@arestaclimb.com",
    assunto: notificacao.assuntoFallback,
    texto: notificacao.texto,
    motivoFalhaWaha: motivoFalha,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      entregueVia: "resend_fallback",
      motivoFalhaWaha: motivoFalha,
    }),
    {
      status: 200,
      headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
    },
  );
}

export default {
  async fetch(requisicao: Request, env: AmbienteAlertas): Promise<Response> {
    if (requisicao.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CABECALHOS_PADRAO });
    }

    const url = new URL(requisicao.url);
    const caminho = url.pathname.replace(/\/+$/, "") || "/";

    if (requisicao.method === "GET" && (caminho === "/" || caminho === "/health")) {
      return new Response(
        JSON.stringify({
          status: "operacional",
          servico: "aresta-alertas-worker",
        }),
        {
          status: 200,
          headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
        },
      );
    }

    if (requisicao.method !== "POST") {
      return new Response(
        JSON.stringify({ erro: "Método não permitido. Utilize POST." }),
        {
          status: 405,
          headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
        },
      );
    }

    if (caminho === "/webhook/sentry") {
      const assinaturaRecebida = requisicao.headers.get("sentry-hook-signature") || "";
      const corpoBruto = await requisicao.text();
      const assinaturaEsperada = await assinarHmacSha256Hex(
        env.SENTRY_WEBHOOK_SECRET || "",
        corpoBruto,
      );

      if (!assinaturaRecebida || !compararTempoConstante(assinaturaRecebida, assinaturaEsperada)) {
        return new Response(
          JSON.stringify({ erro: "Assinatura HMAC do Sentry inválida ou ausente." }),
          {
            status: 401,
            headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
          },
        );
      }

      const recurso = requisicao.headers.get("sentry-hook-resource") || "event_alert";
      const payload = JSON.parse(corpoBruto);
      const notificacao = classificarWebhookSentry(recurso, payload, env);

      if (!notificacao) {
        return new Response(
          JSON.stringify({ ok: true, ignorado: true }),
          {
            status: 200,
            headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
          },
        );
      }

      return await despacharNotificacaoComFallback(notificacao, env);
    }

    if (caminho === "/webhook/github") {
      const cabecalhoAssinatura = requisicao.headers.get("x-hub-signature-256") || "";
      const corpoBruto = await requisicao.text();
      const hashEsperado = await assinarHmacSha256Hex(
        env.GITHUB_WEBHOOK_SECRET || "",
        corpoBruto,
      );
      const assinaturaEsperada = `sha256=${hashEsperado}`;

      if (!cabecalhoAssinatura || !compararTempoConstante(cabecalhoAssinatura, assinaturaEsperada)) {
        return new Response(
          JSON.stringify({ erro: "Assinatura HMAC do GitHub inválida ou ausente." }),
          {
            status: 401,
            headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
          },
        );
      }

      const eventoGithub = requisicao.headers.get("x-github-event") || "";
      const payload = JSON.parse(corpoBruto);
      const notificacao = classificarWebhookGithub(eventoGithub, payload, env);

      if (!notificacao) {
        return new Response(
          JSON.stringify({ ok: true, ignorado: true }),
          {
            status: 200,
            headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
          },
        );
      }

      return await despacharNotificacaoComFallback(notificacao, env);
    }

    return new Response(
      JSON.stringify({ erro: "Rota de webhook não encontrada." }),
      {
        status: 404,
        headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
      },
    );
  },
};
