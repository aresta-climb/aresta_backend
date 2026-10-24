// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ClienteResendFake,
  ClienteWahaFake,
} from "../src/cliente_notificacao_fake.ts";
import worker, {
  AmbienteAlertas,
  assinarHmacSha256Hex,
  ClienteResendHttp,
  ClienteWahaHttp,
} from "../src/index.ts";

function criarAmbientePadrao(
  wahaFake: ClienteWahaFake,
  resendFake: ClienteResendFake,
): AmbienteAlertas {
  return {
    WAHA_BASE_URL: "https://waha.arestaclimb.com",
    WAHA_API_KEY: "waha-secret-key",
    WAHA_SESSION: "default",
    WHATSAPP_GRUPO_EMERGENCIAS_ID: "120363000001@g.us",
    WHATSAPP_GRUPO_BUGS_ID: "120363000002@g.us",
    SENTRY_WEBHOOK_SECRET: "segredo-sentry-hmac",
    GITHUB_WEBHOOK_SECRET: "segredo-github-hmac",
    RESEND_API_KEY: "re_chave_secreta",
    EMAIL_REMETENTE_ALERTA: "alerta@login.arestaclimb.com",
    EMAIL_DESTINATARIO_FALLBACK: "contato@arestaclimb.com",
    clienteWaha: wahaFake,
    clienteResend: resendFake,
  };
}

Deno.test("alertas-worker: responde a OPTIONS com 204, healthcheck em / e /health com 200, 405 para PUT e 404 para rota desconhecida", async () => {
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake);

  const resOptions = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", { method: "OPTIONS" }),
    env,
  );
  assertEquals(resOptions.status, 204);

  const resHealth = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/health", { method: "GET" }),
    env,
  );
  assertEquals(resHealth.status, 200);
  const corpoHealth = await resHealth.json();
  assertEquals(corpoHealth.servico, "aresta-alertas-worker");

  const resPut = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", { method: "PUT" }),
    env,
  );
  assertEquals(resPut.status, 405);

  const res404 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/rota-inexistente", { method: "POST" }),
    env,
  );
  assertEquals(res404.status, 404);
});

Deno.test("alertas-worker: rejeita POST /webhook/sentry e POST /webhook/github com assinatura HMAC ausente ou invalida (401)", async () => {
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake);

  const resSentrySemAssinatura = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      body: JSON.stringify({ action: "triggered" }),
    }),
    env,
  );
  assertEquals(resSentrySemAssinatura.status, 401);

  const resSentryAssinaturaInvalida = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: { "sentry-hook-signature": "assinatura-falsa" },
      body: JSON.stringify({ action: "triggered" }),
    }),
    env,
  );
  assertEquals(resSentryAssinaturaInvalida.status, 401);

  const resGithubSemAssinatura = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: { "x-github-event": "issues" },
      body: JSON.stringify({ action: "opened" }),
    }),
    env,
  );
  assertEquals(resGithubSemAssinatura.status, 401);

  const resGithubAssinaturaInvalida = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": "sha256=invalido",
      },
      body: JSON.stringify({ action: "opened" }),
    }),
    env,
  );
  assertEquals(resGithubAssinaturaInvalida.status, 401);
  assertEquals(wahaFake.mensagensEnviadas.length, 0);
});

Deno.test("alertas-worker: roteia Crash Fatal, Spike (metric_alert) e Uptime do Sentry para Grupo 1 (Emergencias) e ignora eventos comuns", async () => {
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake);

  // 1. Crash Fatal
  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Null check operator used on a null value",
        web_url: "https://aresta-climb.sentry.io/issues/111/",
        tags: [
          ["service", "aresta-app"],
          ["environment", "production"],
        ],
      },
    },
  });
  const sigFatal = await assinarHmacSha256Hex(env.SENTRY_WEBHOOK_SECRET, corpoFatal);

  const resFatal = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigFatal,
        "sentry-hook-resource": "event_alert",
      },
      body: corpoFatal,
    }),
    env,
  );
  assertEquals(resFatal.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
  assertEquals(wahaFake.mensagensEnviadas[0].chatId, "120363000001@g.us");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "🚨");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "Null check operator");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "https://aresta-climb.sentry.io/issues/111/");

  // 2. Spike Metric Alert
  const corpoSpike = JSON.stringify({
    action: "critical",
    data: {
      description_title: "Spike de erros em aresta-backend (> 30/5min)",
      description_text: "47 eventos nos últimos 5 minutos",
      web_url: "https://aresta-climb.sentry.io/alerts/rules/details/22/",
    },
  });
  const sigSpike = await assinarHmacSha256Hex(env.SENTRY_WEBHOOK_SECRET, corpoSpike);

  const resSpike = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigSpike,
        "sentry-hook-resource": "metric_alert",
      },
      body: corpoSpike,
    }),
    env,
  );
  assertEquals(resSpike.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 2);
  assertEquals(wahaFake.mensagensEnviadas[1].chatId, "120363000001@g.us");
  assertStringIncludes(wahaFake.mensagensEnviadas[1].texto, "Spike de erros em aresta-backend");

  // 3. Evento não-emergencial ignorado
  const corpoIgnorado = JSON.stringify({
    action: "resolved",
    data: {},
  });
  const sigIgnorado = await assinarHmacSha256Hex(env.SENTRY_WEBHOOK_SECRET, corpoIgnorado);

  const resIgnorado = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigIgnorado,
        "sentry-hook-resource": "issue",
      },
      body: corpoIgnorado,
    }),
    env,
  );
  assertEquals(resIgnorado.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 2);
});

Deno.test("alertas-worker: roteia falha de workflow_run na branch main ou tag de release (incluindo aresta_db) para Grupo 1 (Emergencias)", async () => {
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake);

  const corpoFalhaDeployDb = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_db" },
    workflow_run: {
      name: "Compilar e Publicar Catálogo R2",
      head_branch: "main",
      conclusion: "failure",
      html_url: "https://github.com/aresta-climb/aresta_db/actions/runs/999",
      head_commit: {
        message: "Atualiza croqui Serra do Cipó",
        author: { name: "Renato" },
      },
    },
  });
  const sig = await assinarHmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, corpoFalhaDeployDb);

  const res = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sig}`,
      },
      body: corpoFalhaDeployDb,
    }),
    env,
  );

  assertEquals(res.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
  assertEquals(wahaFake.mensagensEnviadas[0].chatId, "120363000001@g.us");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "aresta-climb/aresta_db");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "Compilar e Publicar Catálogo R2");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "https://github.com/aresta-climb/aresta_db/actions/runs/999");

  // Workflow run com sucesso ou em branch secundária deve ser ignorado
  const corpoSucesso = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_db" },
    workflow_run: {
      name: "CI",
      head_branch: "feature-teste",
      conclusion: "failure",
      html_url: "https://github.com/aresta-climb/aresta_db/actions/runs/1000",
    },
  });
  const sigSucesso = await assinarHmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, corpoSucesso);
  const resIgnorado = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sigSucesso}`,
      },
      body: corpoSucesso,
    }),
    env,
  );
  assertEquals(resIgnorado.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
});

Deno.test("alertas-worker: roteia issues.opened (com e sem link do Sentry) e pull_request.opened para Grupo 2 (Bugs & Feedbacks)", async () => {
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake);

  // 1. Issue aberta automaticamente pelo Sentry (contendo link para aresta-climb.sentry.io)
  const corpoIssueSentry = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 142,
      title: "FormatException: Unexpected character",
      html_url: "https://github.com/aresta-climb/aresta_app/issues/142",
      user: { login: "sentry[bot]" },
      labels: [{ name: "bug" }],
      body: "Sentry Issue: [ARESTA-APP-1A](https://aresta-climb.sentry.io/issues/987654321/?referrer=github_integration)\n\n```dart\nFormatException: Unexpected character\n```",
    },
  });
  const sigIssueSentry = await assinarHmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, corpoIssueSentry);

  const resIssueSentry = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sigIssueSentry}`,
      },
      body: corpoIssueSentry,
    }),
    env,
  );
  assertEquals(resIssueSentry.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
  assertEquals(wahaFake.mensagensEnviadas[0].chatId, "120363000002@g.us");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "https://github.com/aresta-climb/aresta_app/issues/142");
  assertStringIncludes(wahaFake.mensagensEnviadas[0].texto, "https://aresta-climb.sentry.io/issues/987654321/");

  // 2. Pull Request aberto
  const corpoPr = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_db" },
    pull_request: {
      number: 88,
      title: "Sugestão: Novo setor em Ouro Preto",
      html_url: "https://github.com/aresta-climb/aresta_db/pull/88",
      user: { login: "aresta-climb-bot[bot]" },
    },
  });
  const sigPr = await assinarHmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, corpoPr);

  const resPr = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": `sha256=${sigPr}`,
      },
      body: corpoPr,
    }),
    env,
  );
  assertEquals(resPr.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 2);
  assertEquals(wahaFake.mensagensEnviadas[1].chatId, "120363000002@g.us");
  assertStringIncludes(wahaFake.mensagensEnviadas[1].texto, "Sugestão: Novo setor em Ouro Preto");
  assertEquals(resendFake.emailsEnviados.length, 0);

  // 3. Evento ping do GitHub deve ser ignorado com 200
  const corpoPing = JSON.stringify({ zen: "Keep it logically awesome." });
  const sigPing = await assinarHmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, corpoPing);
  const resPing = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": `sha256=${sigPing}`,
      },
      body: corpoPing,
    }),
    env,
  );
  assertEquals(resPing.status, 200);
  assertEquals(wahaFake.mensagensEnviadas.length, 2);
});

Deno.test("alertas-worker: aciona fallback de e-mail via Resend para contato@arestaclimb.com exclusivamente quando o WAHA falhar", async () => {
  const wahaFake = new ClienteWahaFake();
  wahaFake.deveFalhar = true;
  wahaFake.statusFalha = 502;
  wahaFake.mensagemFalha = "Bad Gateway no Cloudflare Tunnel (e2-micro offline)";

  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake);

  const corpoIssue = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_db" },
    issue: {
      number: 55,
      title: "[Croqui | cipó] Grampo solto na via 2",
      html_url: "https://github.com/aresta-climb/aresta_db/issues/55",
      user: { login: "aresta-climb-bot[bot]" },
      labels: [{ name: "feedback:croqui" }],
      body: "Descrição do feedback",
    },
  });
  const sig = await assinarHmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, corpoIssue);

  const res = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sig}`,
      },
      body: corpoIssue,
    }),
    env,
  );

  assertEquals(res.status, 200);
  const corpoRes = await res.json();
  assertEquals(corpoRes.entregueVia, "resend_fallback");

  // Verifica que o e-mail de contingência foi disparado para contato@arestaclimb.com
  assertEquals(resendFake.emailsEnviados.length, 1);
  assertEquals(resendFake.emailsEnviados[0].remetente, "alerta@login.arestaclimb.com");
  assertEquals(resendFake.emailsEnviados[0].destinatario, "contato@arestaclimb.com");
  assertStringIncludes(resendFake.emailsEnviados[0].assunto, "[CONTINGÊNCIA WHATSAPP]");
  assertStringIncludes(resendFake.emailsEnviados[0].texto, "Grampo solto na via 2");
  assertStringIncludes(resendFake.emailsEnviados[0].motivoFalhaWaha, "Bad Gateway");
});

Deno.test("ClienteWahaHttp e ClienteResendHttp: clientes HTTP reais enviam payloads corretos e tratam erros de rede", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetchSucesso: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "ok-123" }), { status: 200 });
  };

  const wahaHttp = new ClienteWahaHttp(fetchSucesso);
  const resWaha = await wahaHttp.enviarMensagemGrupo({
    urlBase: "https://waha.arestaclimb.com/",
    chaveApi: "api-123",
    chatId: "120363000001@g.us",
    texto: "Olá grupo",
  });
  assertEquals(resWaha.sucesso, true);
  assertEquals(chamadas[0].url, "https://waha.arestaclimb.com/api/sendText");

  const resendHttp = new ClienteResendHttp(fetchSucesso);
  const resResend = await resendHttp.enviarEmailFallback({
    chaveApi: "re_123",
    remetente: "alerta@login.arestaclimb.com",
    destinatario: "contato@arestaclimb.com",
    assunto: "Assunto",
    texto: "Corpo do alerta",
    motivoFalhaWaha: "HTTP 502",
  });
  assertEquals(resResend.sucesso, true);
  assertEquals(chamadas[1].url, "https://api.resend.com/emails");

  const fetchErroHttp: typeof fetch = async () => new Response("Erro interno", { status: 502 });
  const wahaErroHttp = new ClienteWahaHttp(fetchErroHttp);
  const resWaha502 = await wahaErroHttp.enviarMensagemGrupo({
    urlBase: "https://waha.arestaclimb.com",
    chaveApi: "api-123",
    chatId: "120363000001@g.us",
    texto: "Olá",
  });
  assertEquals(resWaha502.sucesso, false);
  assertEquals(resWaha502.statusHttp, 502);

  const fetchExcecao: typeof fetch = async () => {
    throw new Error("Connection refused");
  };
  const wahaExcecao = new ClienteWahaHttp(fetchExcecao);
  const resWahaEx = await wahaExcecao.enviarMensagemGrupo({
    urlBase: "https://waha.arestaclimb.com",
    chaveApi: "api-123",
    chatId: "120363000001@g.us",
    texto: "Olá",
  });
  assertEquals(resWahaEx.sucesso, false);
  assertEquals(resWahaEx.statusHttp, 0);

  const resendExcecao = new ClienteResendHttp(fetchExcecao);
  const resResendEx = await resendExcecao.enviarEmailFallback({
    chaveApi: "re_123",
    remetente: "alerta@login.arestaclimb.com",
    destinatario: "contato@arestaclimb.com",
    assunto: "Assunto",
    texto: "Corpo",
    motivoFalhaWaha: "Timeout",
  });
  assertEquals(resResendEx.sucesso, false);
});
