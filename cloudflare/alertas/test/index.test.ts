// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ClienteDiscordFake,
  ClienteGithubAppFake,
  ClienteNtfyFake,
  ClienteResendFake,
  ClienteSentryFake,
  ClienteWahaFake,
  FilaRetentativasFake,
} from "../src/cliente_notificacao_fake.ts";
import {
  URL_ICONE_EMERGENCIA,
  URL_ICONE_FEEDBACK_BUGS,
} from "../src/icones_alertas_webp.ts";
import worker, {
  AmbienteAlertas,
  assinarHmacSha256Hex,
  ClienteDiscordHttp,
  ClienteGithubAppHttp,
  ClienteNtfyHttp,
  ClienteResendHttp,
  ClienteSentryHttp,
  ClienteWahaHttp,
  FilaRetentativasKv,
  processarFilaRetentativas,
} from "../src/index.ts";

function criarAmbientePadrao(
  wahaFake?: ClienteWahaFake,
  resendFake?: ClienteResendFake,
  discordFake?: ClienteDiscordFake,
): AmbienteAlertas {
  return {
    DISCORD_WEBHOOK_EMERGENCIAS_URL:
      "https://discord.com/api/webhooks/emergencias/token",
    DISCORD_WEBHOOK_BUGS_URL: "https://discord.com/api/webhooks/bugs/token",
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
    clienteDiscord: discordFake,
    clienteWaha: wahaFake,
    clienteResend: resendFake,
  };
}

Deno.test("alertas-worker: responde a OPTIONS com 204, healthcheck em / e /health com 200, 405 para PUT e 404 para rota desconhecida", async () => {
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake);

  const resOptions = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "OPTIONS",
    }),
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
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "PUT",
    }),
    env,
  );
  assertEquals(resPut.status, 405);

  const res404 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/rota-inexistente", {
      method: "POST",
    }),
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
  const sigFatal = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoFatal,
  );

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
  assertStringIncludes(
    wahaFake.mensagensEnviadas[0].texto,
    "Null check operator",
  );
  assertStringIncludes(
    wahaFake.mensagensEnviadas[0].texto,
    "https://aresta-climb.sentry.io/issues/111/",
  );

  // 2. Spike Metric Alert
  const corpoSpike = JSON.stringify({
    action: "critical",
    data: {
      description_title: "Spike de erros em aresta-backend (> 30/5min)",
      description_text: "47 eventos nos últimos 5 minutos",
      web_url: "https://aresta-climb.sentry.io/alerts/rules/details/22/",
    },
  });
  const sigSpike = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoSpike,
  );

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
  assertStringIncludes(
    wahaFake.mensagensEnviadas[1].texto,
    "Spike de erros em aresta-backend",
  );

  // 3. Evento não-emergencial ignorado
  const corpoIgnorado = JSON.stringify({
    action: "resolved",
    data: {},
  });
  const sigIgnorado = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoIgnorado,
  );

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
  const sig = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoFalhaDeployDb,
  );

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
  assertStringIncludes(
    wahaFake.mensagensEnviadas[0].texto,
    "aresta-climb/aresta_db",
  );
  assertStringIncludes(
    wahaFake.mensagensEnviadas[0].texto,
    "Compilar e Publicar Catálogo R2",
  );
  assertStringIncludes(
    wahaFake.mensagensEnviadas[0].texto,
    "https://github.com/aresta-climb/aresta_db/actions/runs/999",
  );

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
  const sigSucesso = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoSucesso,
  );
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
      body:
        "Sentry Issue: [ARESTA-APP-1A](https://aresta-climb.sentry.io/issues/987654321/?referrer=github_integration)\n\n```dart\nFormatException: Unexpected character\n```",
    },
  });
  const sigIssueSentry = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoIssueSentry,
  );

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
  assertStringIncludes(
    wahaFake.mensagensEnviadas[0].texto,
    "https://github.com/aresta-climb/aresta_app/issues/142",
  );
  assertStringIncludes(
    wahaFake.mensagensEnviadas[0].texto,
    "https://aresta-climb.sentry.io/issues/987654321/",
  );

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
  assertStringIncludes(
    wahaFake.mensagensEnviadas[1].texto,
    "Sugestão: Novo setor em Ouro Preto",
  );
  assertEquals(resendFake.emailsEnviados.length, 0);

  // 3. Evento ping do GitHub deve ser ignorado com 200
  const corpoPing = JSON.stringify({ zen: "Keep it logically awesome." });
  const sigPing = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoPing,
  );
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
  wahaFake.mensagemFalha =
    "Bad Gateway no Cloudflare Tunnel (e2-micro offline)";

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
  assertEquals(
    resendFake.emailsEnviados[0].remetente,
    "alerta@login.arestaclimb.com",
  );
  assertEquals(
    resendFake.emailsEnviados[0].destinatario,
    "contato@arestaclimb.com",
  );
  assertStringIncludes(
    resendFake.emailsEnviados[0].assunto,
    "[CONTINGÊNCIA ALERTA]",
  );
  assertStringIncludes(
    resendFake.emailsEnviados[0].texto,
    "Grampo solto na via 2",
  );
  assertStringIncludes(
    resendFake.emailsEnviados[0].motivoFalhaWaha,
    "Bad Gateway",
  );
});

Deno.test("ClienteWahaHttp e ClienteResendHttp: clientes HTTP reais enviam payloads corretos e tratam erros de rede", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetchSucesso: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
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

  const fetchErroHttp: typeof fetch = async () =>
    new Response("Erro interno", { status: 502 });
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

Deno.test("alertas-worker: despacha para Webhook do Discord (com @everyone) quando apenas Discord esta configurado (WAHA em standby)", async () => {
  const discordFake = new ClienteDiscordFake();
  const resendFake = new ClienteResendFake();
  const env: AmbienteAlertas = {
    DISCORD_WEBHOOK_EMERGENCIAS_URL:
      "https://discord.com/api/webhooks/emergencias/token",
    DISCORD_WEBHOOK_BUGS_URL: "https://discord.com/api/webhooks/bugs/token",
    SENTRY_WEBHOOK_SECRET: "segredo-sentry-hmac",
    GITHUB_WEBHOOK_SECRET: "segredo-github-hmac",
    RESEND_API_KEY: "re_chave_secreta",
    clienteDiscord: discordFake,
    clienteResend: resendFake,
  };

  // 1. Alerta de Emergência (Sentry Fatal)
  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Crash fatal em produção",
        web_url: "https://aresta-climb.sentry.io/issues/555/",
      },
    },
  });
  const sigFatal = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoFatal,
  );

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
  const jsonFatal = await resFatal.json();
  assertEquals(jsonFatal.entregueVia, "discord");
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(
    discordFake.mensagensEnviadas[0].urlWebhook,
    env.DISCORD_WEBHOOK_EMERGENCIAS_URL,
  );
  assertEquals(
    discordFake.mensagensEnviadas[0].texto.includes("@everyone"),
    false,
  );
  assertEquals(
    discordFake.mensagensEnviadas[0].avatarUrl,
    URL_ICONE_EMERGENCIA,
  );
  assertStringIncludes(
    discordFake.mensagensEnviadas[0].texto,
    "Crash fatal em produção",
  );

  // 2. Alerta de Bug / Nova Issue (GitHub)
  const corpoIssue = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 10,
      title: "Erro ao abrir foto de croqui",
      html_url: "https://github.com/aresta-climb/aresta_app/issues/10",
    },
  });
  const sigIssue = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoIssue,
  );

  const resIssue = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sigIssue}`,
      },
      body: corpoIssue,
    }),
    env,
  );
  assertEquals(resIssue.status, 200);
  const jsonIssue = await resIssue.json();
  assertEquals(jsonIssue.entregueVia, "discord");
  assertEquals(discordFake.mensagensEnviadas.length, 2);
  assertEquals(
    discordFake.mensagensEnviadas[1].urlWebhook,
    env.DISCORD_WEBHOOK_BUGS_URL,
  );
  assertEquals(
    discordFake.mensagensEnviadas[1].texto.includes("@everyone"),
    false,
  );
  assertEquals(
    discordFake.mensagensEnviadas[1].avatarUrl,
    URL_ICONE_FEEDBACK_BUGS,
  );
  assertStringIncludes(
    discordFake.mensagensEnviadas[1].texto,
    "Erro ao abrir foto de croqui",
  );
  assertEquals(resendFake.emailsEnviados.length, 0);
});

Deno.test("alertas-worker: despacha simultaneamente para Discord e WAHA quando ambos estao configurados", async () => {
  const discordFake = new ClienteDiscordFake();
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake, discordFake);

  const corpoIssue = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_db" },
    issue: {
      number: 77,
      title: "Novo setor Pedra Rachada",
      html_url: "https://github.com/aresta-climb/aresta_db/issues/77",
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
  const jsonRes = await res.json();
  assertEquals(jsonRes.entregueVia, "discord+whatsapp_waha");
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
  assertEquals(resendFake.emailsEnviados.length, 0);
});

Deno.test("alertas-worker: aciona fallback Resend quando Discord configurado falha e WAHA nao esta ativo", async () => {
  const discordFake = new ClienteDiscordFake();
  discordFake.deveFalhar = true;
  discordFake.statusFalha = 500;
  discordFake.mensagemFalha = "Discord API indisponível";

  const resendFake = new ClienteResendFake();
  const env: AmbienteAlertas = {
    DISCORD_WEBHOOK_EMERGENCIAS_URL:
      "https://discord.com/api/webhooks/emergencias/token",
    SENTRY_WEBHOOK_SECRET: "segredo-sentry-hmac",
    GITHUB_WEBHOOK_SECRET: "segredo-github-hmac",
    RESEND_API_KEY: "re_chave_secreta",
    EMAIL_REMETENTE_ALERTA: "alerta@login.arestaclimb.com",
    EMAIL_DESTINATARIO_FALLBACK: "contato@arestaclimb.com",
    clienteDiscord: discordFake,
    clienteResend: resendFake,
  };

  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Crash do sistema",
        web_url: "https://aresta-climb.sentry.io/issues/777/",
      },
    },
  });
  const sigFatal = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoFatal,
  );

  const res = await worker.fetch(
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
  assertEquals(res.status, 200);
  const jsonRes = await res.json();
  assertEquals(jsonRes.entregueVia, "resend_fallback");
  assertEquals(resendFake.emailsEnviados.length, 1);
  assertStringIncludes(resendFake.emailsEnviados[0].texto, "Crash do sistema");
  assertStringIncludes(
    resendFake.emailsEnviados[0].motivoFalhaWaha,
    "Discord API indisponível",
  );
});

Deno.test("ClienteDiscordHttp: envia webhook real silencioso (sem @everyone) com ?wait=true, resolve urlMensagem, define avatar_url, trunca textos longos e trata erros", async () => {
  const chamadas: Array<{ metodo: string; url: string; corpoJson: any }> = [];
  const fetchSucesso: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const metodo = init?.method || "GET";
    const url = String(input);
    chamadas.push({
      metodo,
      url,
      corpoJson: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (metodo === "GET") {
      return new Response(
        JSON.stringify({ guild_id: "777000", channel_id: "888000" }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ id: "999001", channel_id: "888000" }),
      { status: 200 },
    );
  };

  const discordHttp = new ClienteDiscordHttp(fetchSucesso);
  const resSucesso = await discordHttp.enviarMensagemWebhook({
    urlWebhook: "https://discord.com/api/webhooks/123/xyz",
    texto: "🚨 Emergência teste\n\n@everyone",
    avatarUrl: URL_ICONE_EMERGENCIA,
  });
  assertEquals(resSucesso.sucesso, true);
  assertEquals(resSucesso.statusHttp, 200);
  assertEquals(
    resSucesso.urlMensagem,
    "https://discord.com/channels/777000/888000/999001",
  );
  assertEquals(
    chamadas[0].url,
    "https://discord.com/api/webhooks/123/xyz?wait=true",
  );
  assertEquals(chamadas[0].corpoJson.content.includes("@everyone"), false);
  assertStringIncludes(chamadas[0].corpoJson.content, "Emergência teste");
  assertEquals(chamadas[0].corpoJson.allowed_mentions.parse, []);
  assertEquals(chamadas[0].corpoJson.avatar_url, URL_ICONE_EMERGENCIA);

  // Teste de truncamento preventivo (> 2000 chars) usando cache de guild_id
  const textoLongo = "A".repeat(2500);
  const resLongo = await discordHttp.enviarMensagemWebhook({
    urlWebhook: "https://discord.com/api/webhooks/123/xyz",
    texto: textoLongo,
  });
  assertEquals(resLongo.sucesso, true);
  assertEquals(
    resLongo.urlMensagem,
    "https://discord.com/channels/777000/888000/999001",
  );
  const chamadaPostLongo = chamadas.find((c, i) =>
    i > 0 && c.metodo === "POST"
  )!;
  assertEquals(chamadaPostLongo.corpoJson.content.length <= 1990, true);
  assertEquals(chamadaPostLongo.corpoJson.avatar_url, undefined);

  // Erro HTTP do Discord
  const fetchErro: typeof fetch = async () =>
    new Response("Rate limited", { status: 429 });
  const discordErro = new ClienteDiscordHttp(fetchErro);
  const resErro = await discordErro.enviarMensagemWebhook({
    urlWebhook: "https://discord.com/api/webhooks/123/xyz",
    texto: "Teste",
  });
  assertEquals(resErro.sucesso, false);
  assertEquals(resErro.statusHttp, 429);

  // Exceção de rede
  const fetchExcecao: typeof fetch = async () => {
    throw new Error("DNS resolution failed");
  };
  const discordExcecao = new ClienteDiscordHttp(fetchExcecao);
  const resExcecao = await discordExcecao.enviarMensagemWebhook({
    urlWebhook: "https://discord.com/api/webhooks/123/xyz",
    texto: "Teste",
  });
  assertEquals(resExcecao.sucesso, false);
  assertEquals(resExcecao.statusHttp, 0);
  assertStringIncludes(resExcecao.erro || "", "DNS resolution failed");
});

Deno.test("alertas-worker: despacha exclusivamente para WAHA quando Discord nao esta configurado", async () => {
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env: AmbienteAlertas = {
    WAHA_BASE_URL: "https://waha.arestaclimb.com",
    WAHA_API_KEY: "waha-secret-key",
    WAHA_SESSION: "sessao-customizada",
    WHATSAPP_GRUPO_EMERGENCIAS_ID: "120363000001@g.us",
    WHATSAPP_GRUPO_BUGS_ID: "120363000002@g.us",
    SENTRY_WEBHOOK_SECRET: "segredo-sentry-hmac",
    GITHUB_WEBHOOK_SECRET: "segredo-github-hmac",
    RESEND_API_KEY: "re_chave_secreta",
    clienteWaha: wahaFake,
    clienteResend: resendFake,
  };

  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Crash do sistema sem Discord",
        web_url: "https://aresta-climb.sentry.io/issues/999/",
      },
    },
  });
  const sig = await assinarHmacSha256Hex(env.SENTRY_WEBHOOK_SECRET, corpoFatal);

  const res = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sig,
        "sentry-hook-resource": "event_alert",
      },
      body: corpoFatal,
    }),
    env,
  );

  assertEquals(res.status, 200);
  const jsonRes = await res.json();
  assertEquals(jsonRes.entregueVia, "whatsapp_waha");
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
  assertEquals(wahaFake.mensagensEnviadas[0].sessao, "sessao-customizada");
  assertEquals(resendFake.emailsEnviados.length, 0);
});

Deno.test("ClienteWahaHttp: utiliza sessao customizada quando fornecida", async () => {
  let corpoEnviado: any = null;
  const fetchMock: typeof fetch = async (
    _url: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    corpoEnviado = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const wahaHttp = new ClienteWahaHttp(fetchMock);
  const res = await wahaHttp.enviarMensagemGrupo({
    urlBase: "https://waha.arestaclimb.com",
    chaveApi: "key",
    chatId: "120363@g.us",
    texto: "teste",
    sessao: "minha-sessao",
  });

  assertEquals(res.sucesso, true);
  assertEquals(corpoEnviado.session, "minha-sessao");
});

Deno.test("alertas-worker: CANAL_ALERTAS_ATIVO='discord' forca envio apenas ao Discord mesmo com WAHA configurado", async () => {
  const discordFake = new ClienteDiscordFake();
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";

  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Crash teste canal discord",
        web_url: "https://aresta-climb.sentry.io/issues/123/",
      },
    },
  });
  const sig = await assinarHmacSha256Hex(env.SENTRY_WEBHOOK_SECRET, corpoFatal);

  const res = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sig,
        "sentry-hook-resource": "event_alert",
      },
      body: corpoFatal,
    }),
    env,
  );

  assertEquals(res.status, 200);
  const jsonRes = await res.json();
  assertEquals(jsonRes.entregueVia, "discord");
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(wahaFake.mensagensEnviadas.length, 0);
  assertEquals(resendFake.emailsEnviados.length, 0);
});

Deno.test("alertas-worker: CANAL_ALERTAS_ATIVO='whatsapp' forca envio apenas ao WAHA mesmo com Discord configurado", async () => {
  const discordFake = new ClienteDiscordFake();
  const wahaFake = new ClienteWahaFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(wahaFake, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "whatsapp";

  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Crash teste canal whatsapp",
        web_url: "https://aresta-climb.sentry.io/issues/124/",
      },
    },
  });
  const sig = await assinarHmacSha256Hex(env.SENTRY_WEBHOOK_SECRET, corpoFatal);

  const res = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sig,
        "sentry-hook-resource": "event_alert",
      },
      body: corpoFatal,
    }),
    env,
  );

  assertEquals(res.status, 200);
  const jsonRes = await res.json();
  assertEquals(jsonRes.entregueVia, "whatsapp_waha");
  assertEquals(discordFake.mensagensEnviadas.length, 0);
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
  assertEquals(resendFake.emailsEnviados.length, 0);
});

Deno.test("alertas-worker: posiciona o gist na primeira linha, define avatarUrl customizado e nao inclui @everyone na mensagem do Discord", async () => {
  const discordFake = new ClienteDiscordFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";

  const corpoIssue = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 42,
      title: "Falha ao carregar foto offline",
      html_url: "https://github.com/aresta-climb/aresta_app/issues/42",
      labels: [{ name: "bug" }],
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
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  const textoEnviado = discordFake.mensagensEnviadas[0].texto;
  assertEquals(textoEnviado.includes("@everyone"), false);
  assertEquals(
    discordFake.mensagensEnviadas[0].avatarUrl,
    URL_ICONE_FEEDBACK_BUGS,
  );
  assertStringIncludes(
    textoEnviado.split("\n")[0],
    "Falha ao carregar foto offline",
  );
});

Deno.test("alertas-worker: cria GitHub Issue automatica com label 'emergencia' para alertas do Sentry e workflow_run e inclui o link na notificacao", async () => {
  const discordFake = new ClienteDiscordFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-client-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "app-private-key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "99999";
  env.clienteGithubApp = githubFake;

  // 1. Crash Fatal no Sentry em aresta-backend -> cria issue em aresta-climb/aresta_backend
  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Database connection pool exhausted",
        web_url: "https://aresta-climb.sentry.io/issues/5001/",
        tags: [["service", "aresta-backend"]],
      },
    },
  });
  const sigFatal = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoFatal,
  );

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
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(
    githubFake.issuesCriadas[0].repositorio,
    "aresta-climb/aresta_backend",
  );
  assertEquals(githubFake.issuesCriadas[0].labels, ["emergencia"]);
  assertStringIncludes(
    githubFake.issuesCriadas[0].corpo,
    "https://aresta-climb.sentry.io/issues/5001/",
  );
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertStringIncludes(
    discordFake.mensagensEnviadas[0].texto,
    "https://github.com/aresta-climb/aresta_backend/issues/1",
  );

  // 2. Falha de workflow_run em aresta_db -> cria issue em aresta-climb/aresta_db
  const corpoWorkflow = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_db" },
    workflow_run: {
      name: "Compilar SQLite",
      head_branch: "main",
      conclusion: "failure",
      html_url: "https://github.com/aresta-climb/aresta_db/actions/runs/777",
      head_commit: {
        message: "feat: atualizar setores",
        author: { name: "Renato" },
      },
    },
  });
  const sigWf = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoWorkflow,
  );

  const resWf = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sigWf}`,
      },
      body: corpoWorkflow,
    }),
    env,
  );
  assertEquals(resWf.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 2);
  assertEquals(
    githubFake.issuesCriadas[1].repositorio,
    "aresta-climb/aresta_db",
  );
  assertEquals(githubFake.issuesCriadas[1].labels, ["bug"]);
  assertEquals(discordFake.mensagensEnviadas.length, 2);
  assertStringIncludes(
    discordFake.mensagensEnviadas[1].texto,
    "https://github.com/aresta-climb/aresta_db/issues/2",
  );
});

Deno.test("alertas-worker: ignora issues.opened com label 'emergencia' e notifica issues/PRs reabertos no canal correspondente", async () => {
  const discordFake = new ClienteDiscordFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";

  // 1. issues.opened COM label 'emergencia' -> deve ser ignorado (200 OK, ignorado: true)
  const corpoIssueEmergenciaAberta = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_backend" },
    issue: {
      number: 1,
      title: "🚨 [EMERGÊNCIA] Crash fatal",
      html_url: "https://github.com/aresta-climb/aresta_backend/issues/1",
      labels: [{ name: "emergencia" }],
    },
  });
  const sig1 = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoIssueEmergenciaAberta,
  );

  const res1 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sig1}`,
      },
      body: corpoIssueEmergenciaAberta,
    }),
    env,
  );
  assertEquals(res1.status, 200);
  assertEquals((await res1.json()).ignorado, true);
  assertEquals(discordFake.mensagensEnviadas.length, 0);

  // 2. issues.reopened COM label 'emergencia' -> notifica no canal de emergencias
  const corpoIssueEmergenciaReaberta = JSON.stringify({
    action: "reopened",
    repository: { full_name: "aresta-climb/aresta_backend" },
    issue: {
      number: 1,
      title: "🚨 [EMERGÊNCIA] Crash fatal",
      html_url: "https://github.com/aresta-climb/aresta_backend/issues/1",
      labels: [{ name: "emergencia" }],
    },
  });
  const sig2 = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoIssueEmergenciaReaberta,
  );

  const res2 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sig2}`,
      },
      body: corpoIssueEmergenciaReaberta,
    }),
    env,
  );
  assertEquals(res2.status, 200);
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(
    discordFake.mensagensEnviadas[0].urlWebhook,
    env.DISCORD_WEBHOOK_EMERGENCIAS_URL,
  );

  // 3. issues.reopened SEM label 'emergencia' -> notifica no canal de bugs
  const corpoBugReaberto = JSON.stringify({
    action: "reopened",
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 15,
      title: "Botão desalinhado",
      html_url: "https://github.com/aresta-climb/aresta_app/issues/15",
      labels: [{ name: "bug" }],
    },
  });
  const sig3 = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoBugReaberto,
  );

  const res3 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sig3}`,
      },
      body: corpoBugReaberto,
    }),
    env,
  );
  assertEquals(res3.status, 200);
  assertEquals(discordFake.mensagensEnviadas.length, 2);
  assertEquals(
    discordFake.mensagensEnviadas[1].urlWebhook,
    env.DISCORD_WEBHOOK_BUGS_URL,
  );

  // 4. pull_request.reopened -> notifica no canal de bugs
  const corpoPrReaberto = JSON.stringify({
    action: "reopened",
    repository: { full_name: "aresta-climb/aresta_db" },
    pull_request: {
      number: 20,
      title: "Revisão de croqui",
      html_url: "https://github.com/aresta-climb/aresta_db/pull/20",
      user: { login: "escalador" },
    },
  });
  const sig4 = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoPrReaberto,
  );

  const res4 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": `sha256=${sig4}`,
      },
      body: corpoPrReaberto,
    }),
    env,
  );
  assertEquals(res4.status, 200);
  assertEquals(discordFake.mensagensEnviadas.length, 3);
  assertEquals(
    discordFake.mensagensEnviadas[2].urlWebhook,
    env.DISCORD_WEBHOOK_BUGS_URL,
  );
});

Deno.test("alertas-worker: sincroniza bidirecionalmente fechamento e reabertura de issues entre Sentry e GitHub com protecao anti-loop", async () => {
  const discordFake = new ClienteDiscordFake();
  const githubFake = new ClienteGithubAppFake();
  const sentryFake = new ClienteSentryFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.SENTRY_API_TOKEN = "sntrys_token_secreto";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteGithubApp = githubFake;
  env.clienteSentry = sentryFake;

  // 1. GitHub -> Sentry: humano fecha issue no GitHub que tem link do Sentry -> resolve no Sentry
  const corpoFechamentoHumano = JSON.stringify({
    action: "closed",
    sender: { login: "renato", type: "User" },
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 33,
      title: "Crash no mapa",
      body: "Erro capturado em https://aresta-climb.sentry.io/issues/987654/",
    },
  });
  const sigClose = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoFechamentoHumano,
  );

  const resClose = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sigClose}`,
      },
      body: corpoFechamentoHumano,
    }),
    env,
  );
  assertEquals(resClose.status, 200);
  assertEquals(sentryFake.atualizacoesStatus.length, 1);
  assertEquals(sentryFake.atualizacoesStatus[0].idIssueSentry, "987654");
  assertEquals(sentryFake.atualizacoesStatus[0].novoStatus, "resolved");

  // 2. GitHub -> Sentry (Anti-loop): bot fecha issue no GitHub -> NÃO chama Sentry de volta
  const corpoFechamentoBot = JSON.stringify({
    action: "closed",
    sender: { login: "aresta-climb-bot[bot]", type: "Bot" },
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 33,
      title: "Crash no mapa",
      body: "Erro capturado em https://aresta-climb.sentry.io/issues/987654/",
    },
  });
  const sigCloseBot = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoFechamentoBot,
  );

  const resCloseBot = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sigCloseBot}`,
      },
      body: corpoFechamentoBot,
    }),
    env,
  );
  assertEquals(resCloseBot.status, 200);
  assertEquals(sentryFake.atualizacoesStatus.length, 1); // Manteve 1, não chamou de novo

  // 3. Sentry -> GitHub: issue resolvida no Sentry -> fecha issue no GitHub
  const corpoSentryResolved = JSON.stringify({
    action: "resolved",
    data: {
      issue: {
        id: "987654",
      },
    },
  });
  const sigSentryRes = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoSentryResolved,
  );

  const resSentryRes = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigSentryRes,
        "sentry-hook-resource": "issue",
      },
      body: corpoSentryResolved,
    }),
    env,
  );
  assertEquals(resSentryRes.status, 200);
  assertEquals(githubFake.sincronizacoesEstado.length, 1);
  assertEquals(githubFake.sincronizacoesEstado[0].idIssueSentry, "987654");
  assertEquals(githubFake.sincronizacoesEstado[0].novoEstado, "closed");

  // 4. Sentry -> GitHub: issue marcada como unresolved no Sentry -> reabre issue no GitHub
  const corpoSentryUnresolved = JSON.stringify({
    action: "unresolved",
    data: {
      issue: {
        id: "987654",
      },
    },
  });
  const sigSentryUnres = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoSentryUnresolved,
  );

  const resSentryUnres = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigSentryUnres,
        "sentry-hook-resource": "issue",
      },
      body: corpoSentryUnresolved,
    }),
    env,
  );
  assertEquals(resSentryUnres.status, 200);
  assertEquals(githubFake.sincronizacoesEstado.length, 2);
  assertEquals(githubFake.sincronizacoesEstado[1].novoEstado, "open");
});

Deno.test("alertas-worker: enfileira falhas de criacao de issue no GitHub e falhas do Discord e reprocessa no Cron Trigger (scheduled)", async () => {
  const discordFake = new ClienteDiscordFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const filaFake = new FilaRetentativasFake();

  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteGithubApp = githubFake;
  env.filaRetentativas = filaFake;

  // Simula outage tanto no GitHub quanto no Discord
  githubFake.deveFalhar = true;
  discordFake.deveFalhar = true;

  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Outage simultâneo",
        web_url: "https://aresta-climb.sentry.io/issues/4040/",
        tags: [["service", "arestaclimb-com"]],
      },
    },
  });
  const sigFatal = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoFatal,
  );

  const res = await worker.fetch(
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
  assertEquals(res.status, 200);
  // Caiu para o fallback de e-mail do Resend imediatamente
  assertEquals(resendFake.emailsEnviados.length, 1);
  // Enfileirou 2 tarefas pendentes: criar_issue_emergencia e enviar_notificacao_discord
  const pendentesAntes = await filaFake.listarPendentes();
  assertEquals(pendentesAntes.length, 2);

  // Agora GitHub e Discord voltam a funcionar no próximo ciclo do Cron Trigger
  githubFake.deveFalhar = false;
  discordFake.deveFalhar = false;

  await processarFilaRetentativas(env);

  // Fila deve estar vazia após sucesso no reprocessamento
  const pendentesDepois = await filaFake.listarPendentes();
  assertEquals(pendentesDepois.length, 0);
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(
    githubFake.issuesCriadas[0].repositorio,
    "aresta-climb/arestaclimb.com",
  );
  assertEquals(discordFake.mensagensEnviadas.length, 2);
});

Deno.test("ClienteSentryHttp: envia PUT para API do Sentry e trata erros HTTP e de rede", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetchSucesso: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    chamadas.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "987654", status: "resolved" }), {
      status: 200,
    });
  };

  const sentryHttp = new ClienteSentryHttp(fetchSucesso);
  const resOk = await sentryHttp.atualizarStatusIssue({
    tokenApi: "sntrys_token_123",
    idIssueSentry: "987654",
    novoStatus: "resolved",
  });
  assertEquals(resOk.sucesso, true);
  assertEquals(resOk.statusHttp, 200);
  assertEquals(chamadas[0].url, "https://sentry.io/api/0/issues/987654/");

  const fetchErro: typeof fetch = async () =>
    new Response("Forbidden", { status: 403 });
  const resErro = await new ClienteSentryHttp(fetchErro).atualizarStatusIssue({
    tokenApi: "invalido",
    idIssueSentry: "987654",
    novoStatus: "unresolved",
  });
  assertEquals(resErro.sucesso, false);
  assertEquals(resErro.statusHttp, 403);

  const fetchExcecao: typeof fetch = async () => {
    throw new Error("Network failure");
  };
  const resExcecao = await new ClienteSentryHttp(fetchExcecao)
    .atualizarStatusIssue({
      tokenApi: "token",
      idIssueSentry: "987654",
      novoStatus: "resolved",
    });
  assertEquals(resExcecao.sucesso, false);
  assertEquals(resExcecao.statusHttp, 0);
});

Deno.test("FilaRetentativasKv: armazena, lista e remove itens usando a interface de KVNamespace", async () => {
  const mapaKv = new Map<string, string>();
  const kvSimulado = {
    async put(chave: string, valor: string): Promise<void> {
      mapaKv.set(chave, valor);
    },
    async get(chave: string): Promise<string | null> {
      return mapaKv.get(chave) ?? null;
    },
    async delete(chave: string): Promise<void> {
      mapaKv.delete(chave);
    },
    async list(): Promise<{ keys: Array<{ name: string }> }> {
      return {
        keys: Array.from(mapaKv.keys()).map((name) => ({ name })),
      };
    },
  };

  const filaKv = new FilaRetentativasKv(kvSimulado as any);
  await filaKv.enfileirar({
    id: "ret-1",
    tipo: "enviar_notificacao_discord",
    criadoEmIso: "2026-10-25T12:00:00Z",
    tentativas: 1,
    dadosDiscord: {
      categoria: "emergencias",
      texto: "🚨 Teste KV",
    },
  });

  const pendentes = await filaKv.listarPendentes();
  assertEquals(pendentes.length, 1);
  assertEquals(pendentes[0].id, "ret-1");

  await filaKv.remover("ret-1");
  assertEquals((await filaKv.listarPendentes()).length, 0);
});

Deno.test("ClienteGithubAppHttp: assina JWT RS256 (PKCS#8 e PKCS#1), obtem installation token, cria issue e sincroniza estado", async () => {
  // Gera um par de chaves RSA real de 2048 bits via Web Crypto para testar sem mocks criptográficos
  const parChaves = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8Buffer = await crypto.subtle.exportKey(
    "pkcs8",
    parChaves.privateKey,
  );
  const pkcs8Bytes = new Uint8Array(pkcs8Buffer);
  let binario = "";
  for (let i = 0; i < pkcs8Bytes.length; i++) {
    binario += String.fromCharCode(pkcs8Bytes[i]);
  }
  const pemPkcs8 = `-----BEGIN PRIVATE KEY-----\n${
    btoa(binario)
  }\n-----END PRIVATE KEY-----`;

  const chamadasUrl: string[] = [];
  const fetchSimulado: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    chamadasUrl.push(`${init?.method || "GET"} ${url}`);

    if (url.endsWith("/access_tokens")) {
      return new Response(
        JSON.stringify({ token: "ghs_instalacao_token_real" }),
        { status: 201 },
      );
    }
    if (
      url.endsWith("/repos/aresta-climb/aresta_backend/issues") &&
      init?.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          number: 77,
          html_url: "https://github.com/aresta-climb/aresta_backend/issues/77",
        }),
        { status: 201 },
      );
    }
    if (url.includes("/search/issues")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              number: 77,
              state: "open",
              repository_url:
                "https://api.github.com/repos/aresta-climb/aresta_backend",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (
      url.endsWith("/repos/aresta-climb/aresta_backend/issues/77") &&
      init?.method === "PATCH"
    ) {
      return new Response(JSON.stringify({ number: 77, state: "closed" }), {
        status: 200,
      });
    }
    if (
      url.endsWith("/repos/aresta-climb/aresta_db/actions/runs/900/jobs") &&
      init?.method === "GET"
    ) {
      return new Response(
        JSON.stringify({
          jobs: [
            {
              steps: [
                { name: "Setup uv e Python", conclusion: "success" },
                { name: "Run Validator", conclusion: "failure" },
                { name: "Erro Interno no Script de Validação", conclusion: "skipped" },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("Not Found", { status: 404 });
  };

  const githubHttp = new ClienteGithubAppHttp(fetchSimulado);

  const resCriacao = await githubHttp.criarIssueEmergencia({
    clientId: "Iv1.123456",
    privateKey: pemPkcs8,
    installationId: "55555",
    repositorio: "aresta-climb/aresta_backend",
    titulo: "🚨 [EMERGÊNCIA] Teste Real RSA",
    corpo: "Corpo da issue",
    labels: ["emergencia"],
  });
  assertEquals(resCriacao.sucesso, true);
  assertEquals(resCriacao.numeroIssue, 77);
  assertEquals(
    resCriacao.urlIssue,
    "https://github.com/aresta-climb/aresta_backend/issues/77",
  );

  const resSync = await githubHttp.sincronizarEstadoIssuePorIdSentry({
    clientId: "Iv1.123456",
    privateKey: pemPkcs8,
    installationId: "55555",
    idIssueSentry: "5001",
    novoEstado: "closed",
  });
  assertEquals(resSync.sucesso, true);
  assertEquals(resSync.issuesEncontradas, 1);
  assertEquals(resSync.issuesAtualizadas, 1);
  const chamadaBusca = chamadasUrl.find((c) => c.includes("/search/issues"))!;
  const queryDecodificada = decodeURIComponent(chamadaBusca.split("?q=")[1] || "");
  assertStringIncludes(queryDecodificada, 'in:body "issues/5001"');
  assertEquals(queryDecodificada.includes("sentry.io/issues/"), false);

  // Quando a issue encontrada já está no mesmo estado ('open'), não envia PATCH redundante
  const resSyncJaAberta = await githubHttp.sincronizarEstadoIssuePorIdSentry({
    clientId: "Iv1.123456",
    privateKey: pemPkcs8,
    installationId: "55555",
    idIssueSentry: "5001",
    novoEstado: "open",
  });
  assertEquals(resSyncJaAberta.sucesso, true);
  assertEquals(resSyncJaAberta.issuesEncontradas, 1);
  assertEquals(resSyncJaAberta.issuesAtualizadas, 0);

  const resJobs = await githubHttp.obterStepsFalhosWorkflowRun({
    clientId: "Iv1.123456",
    privateKey: pemPkcs8,
    installationId: "55555",
    repositorio: "aresta-climb/aresta_db",
    runId: 900,
  });
  assertEquals(resJobs.sucesso, true);
  assertEquals(resJobs.nomesStepsFalhos, ["Run Validator"]);
  assertEquals(chamadasUrl.length, 9);
});

Deno.test("alertas-worker: serve icones WebP comprimidos em /icones/emergencia.webp e /icones/feedback_bugs.webp", async () => {
  const env = criarAmbientePadrao();

  const resEmergencia = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/icones/emergencia.webp", {
      method: "GET",
    }),
    env,
  );
  assertEquals(resEmergencia.status, 200);
  assertEquals(resEmergencia.headers.get("content-type"), "image/webp");
  assertStringIncludes(
    resEmergencia.headers.get("cache-control") || "",
    "immutable",
  );
  const bytesEmergencia = new Uint8Array(await resEmergencia.arrayBuffer());
  assertEquals(
    bytesEmergencia.length > 1000 && bytesEmergencia.length < 25000,
    true,
  );
  assertEquals(new TextDecoder().decode(bytesEmergencia.slice(0, 4)), "RIFF");
  assertEquals(new TextDecoder().decode(bytesEmergencia.slice(8, 12)), "WEBP");

  const resBugs = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/icones/feedback_bugs.webp", {
      method: "GET",
    }),
    env,
  );
  assertEquals(resBugs.status, 200);
  assertEquals(resBugs.headers.get("content-type"), "image/webp");
  const bytesBugs = new Uint8Array(await resBugs.arrayBuffer());
  assertEquals(bytesBugs.length > 1000 && bytesBugs.length < 25000, true);
  assertEquals(new TextDecoder().decode(bytesBugs.slice(0, 4)), "RIFF");
  assertEquals(new TextDecoder().decode(bytesBugs.slice(8, 12)), "WEBP");
});

Deno.test("alertas-worker: despacha notificacoes push ricas via ntfy com prioridade 5 (emergencias), prioridade 3 (bugs), icones WebP e botoes de acao", async () => {
  const discordFake = new ClienteDiscordFake();
  const ntfyFake = new ClienteNtfyFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.NTFY_BASE_URL = "https://ntfy.sh";
  env.NTFY_TOPICO_EMERGENCIAS = "aresta-emergencias-segredo-999";
  env.NTFY_TOPICO_BUGS = "aresta-bugs-segredo-888";
  env.NTFY_API_TOKEN = "tk_ntfy_secreto";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteNtfy = ntfyFake;
  env.clienteGithubApp = githubFake;

  // 1. Emergência (Sentry Fatal) -> cria issue #1 e envia push ntfy com prioridade 5
  const corpoFatal = JSON.stringify({
    action: "triggered",
    data: {
      event: {
        level: "fatal",
        title: "Out of memory no SyncWorker",
        web_url: "https://aresta-climb.sentry.io/issues/7070/",
        tags: [["service", "aresta-app"]],
      },
    },
  });
  const sigFatal = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoFatal,
  );

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
  const jsonFatal = await resFatal.json();
  assertStringIncludes(jsonFatal.entregueVia, "discord");
  assertStringIncludes(jsonFatal.entregueVia, "ntfy");

  assertEquals(ntfyFake.notificacoesEnviadas.length, 1);
  const pushEmergencia = ntfyFake.notificacoesEnviadas[0];
  assertEquals(pushEmergencia.topico, "aresta-emergencias-segredo-999");
  assertEquals(pushEmergencia.prioridade, 5);
  assertEquals(pushEmergencia.iconeUrl, URL_ICONE_EMERGENCIA);
  assertEquals(pushEmergencia.tokenApi, "tk_ntfy_secreto");
  assertStringIncludes(pushEmergencia.titulo, "Aresta Climb •");
  assertStringIncludes(pushEmergencia.mensagem, "Out of memory no SyncWorker");
  assertEquals(
    pushEmergencia.urlClique,
    "https://github.com/aresta-climb/aresta_app/issues/1",
  );
  assertEquals(pushEmergencia.acoes, [
    {
      action: "view",
      label: "Discord",
      url: "https://discord.com/channels/1000/2000/3001",
    },
    {
      action: "view",
      label: "GitHub",
      url: "https://github.com/aresta-climb/aresta_app/issues/1",
    },
    {
      action: "view",
      label: "Sentry",
      url: "https://aresta-climb.sentry.io/issues/7070/",
    },
  ]);

  // 2. Bug / Nova Issue no GitHub (com link do Sentry no corpo) -> envia push ntfy com prioridade 3 e 3 botões
  const corpoBug = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 88,
      title: "Filtro de graduação não limpa",
      html_url: "https://github.com/aresta-climb/aresta_app/issues/88",
      body:
        "Issue gerada pelo Sentry: https://aresta-climb.sentry.io/issues/8080/",
      labels: [{ name: "bug" }],
    },
  });
  const sigBug = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoBug,
  );

  const resBug = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sigBug}`,
      },
      body: corpoBug,
    }),
    env,
  );
  assertEquals(resBug.status, 200);
  assertEquals(ntfyFake.notificacoesEnviadas.length, 2);
  const pushBug = ntfyFake.notificacoesEnviadas[1];
  assertEquals(pushBug.topico, "aresta-bugs-segredo-888");
  assertEquals(pushBug.prioridade, 3);
  assertEquals(pushBug.iconeUrl, URL_ICONE_FEEDBACK_BUGS);
  assertStringIncludes(pushBug.titulo, "Aresta Climb •");
  assertEquals(
    pushBug.urlClique,
    "https://github.com/aresta-climb/aresta_app/issues/88",
  );
  assertEquals(pushBug.acoes, [
    {
      action: "view",
      label: "Discord",
      url: "https://discord.com/channels/1000/2000/3002",
    },
    {
      action: "view",
      label: "GitHub",
      url: "https://github.com/aresta-climb/aresta_app/issues/88",
    },
    {
      action: "view",
      label: "Sentry",
      url: "https://aresta-climb.sentry.io/issues/8080/",
    },
  ]);
});

Deno.test("ClienteNtfyHttp: envia POST JSON ao servidor ntfy com Authorization Bearer opcional e trata falhas", async () => {
  const chamadas: Array<
    { url: string; headers: Record<string, string>; corpo: any }
  > = [];
  const fetchSucesso: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const hdrs: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      hdrs[k.toLowerCase()] = v;
    });
    chamadas.push({
      url: String(input),
      headers: hdrs,
      corpo: JSON.parse(String(init?.body || "{}")),
    });
    return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
  };

  const ntfyHttp = new ClienteNtfyHttp(fetchSucesso);
  const resOk = await ntfyHttp.enviarNotificacaoPush({
    urlBase: "https://ntfy.sh/",
    topico: "aresta-emergencias-xyz",
    titulo: "Aresta Climb • 🚨 [EMERGÊNCIA] Crash",
    mensagem: "Detalhe do crash",
    prioridade: 5,
    tags: ["rotating_light", "aresta-emergencia"],
    iconeUrl: URL_ICONE_EMERGENCIA,
    urlClique: "https://github.com/aresta-climb/aresta_app/issues/1",
    acoes: [
      {
        action: "view",
        label: "Abrir no GitHub",
        url: "https://github.com/aresta-climb/aresta_app/issues/1",
      },
    ],
    tokenApi: "tk_secreto_123",
  });

  assertEquals(resOk.sucesso, true);
  assertEquals(resOk.statusHttp, 200);
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].url, "https://ntfy.sh");
  assertEquals(chamadas[0].headers["authorization"], "Bearer tk_secreto_123");
  assertEquals(chamadas[0].corpo.topic, "aresta-emergencias-xyz");
  assertEquals(chamadas[0].corpo.priority, 5);
  assertEquals(chamadas[0].corpo.icon, URL_ICONE_EMERGENCIA);
  assertEquals(
    chamadas[0].corpo.click,
    "https://github.com/aresta-climb/aresta_app/issues/1",
  );
  assertEquals(chamadas[0].corpo.actions.length, 1);

  const fetchErro: typeof fetch = async () =>
    new Response("Too Many Requests", { status: 429 });
  const resErro = await new ClienteNtfyHttp(fetchErro).enviarNotificacaoPush({
    urlBase: "https://ntfy.sh",
    topico: "topico",
    titulo: "Titulo",
    mensagem: "Msg",
    prioridade: 3,
    tags: [],
    iconeUrl: URL_ICONE_FEEDBACK_BUGS,
  });
  assertEquals(resErro.sucesso, false);
  assertEquals(resErro.statusHttp, 429);

  const fetchExcecao: typeof fetch = async () => {
    throw new Error("Connection reset");
  };
  const resExcecao = await new ClienteNtfyHttp(fetchExcecao)
    .enviarNotificacaoPush({
      urlBase: "https://ntfy.sh",
      topico: "topico",
      titulo: "Titulo",
      mensagem: "Msg",
      prioridade: 3,
      tags: [],
      iconeUrl: URL_ICONE_FEEDBACK_BUGS,
    });
  assertEquals(resExcecao.sucesso, false);
  assertEquals(resExcecao.statusHttp, 0);
  assertStringIncludes(resExcecao.erro || "", "Connection reset");
});

Deno.test("alertas-worker: enfileira falha do ntfy em FILA_RETENTATIVAS_ALERTAS e reprocessa no Cron Trigger", async () => {
  const discordFake = new ClienteDiscordFake();
  const ntfyFake = new ClienteNtfyFake();
  const resendFake = new ClienteResendFake();
  const filaFake = new FilaRetentativasFake();

  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.NTFY_TOPICO_BUGS = "aresta-bugs-segredo-888";
  env.clienteNtfy = ntfyFake;
  env.filaRetentativas = filaFake;

  // ntfy falha temporariamente, mas Discord funciona
  ntfyFake.deveFalhar = true;

  const corpoBug = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 99,
      title: "Bug teste retentativa ntfy",
      html_url: "https://github.com/aresta-climb/aresta_app/issues/99",
    },
  });
  const sigBug = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoBug,
  );

  const res = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sigBug}`,
      },
      body: corpoBug,
    }),
    env,
  );
  assertEquals(res.status, 200);
  const pendentesAntes = await filaFake.listarPendentes();
  assertEquals(pendentesAntes.length, 1);
  assertEquals(pendentesAntes[0].tipo, "enviar_notificacao_ntfy");

  // ntfy volta a ficar disponível no próximo ciclo do Cron Trigger
  ntfyFake.deveFalhar = false;
  await processarFilaRetentativas(env);

  assertEquals((await filaFake.listarPendentes()).length, 0);
  assertEquals(ntfyFake.notificacoesEnviadas.length, 1);
  assertEquals(
    ntfyFake.notificacoesEnviadas[0].topico,
    "aresta-bugs-segredo-888",
  );
});

Deno.test("alertas-worker: roteia falha de check_run de deploy (Cloudflare Pages e Workers Builds) em branch critica para Emergencias e ignora github-actions ou sucesso", async () => {
  const discordFake = new ClienteDiscordFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteGithubApp = githubFake;

  // 1. Falha no Cloudflare Workers Builds na branch main -> Emergência + Issue
  const corpoFalhaCloudflare = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_backend" },
    check_run: {
      name: "Workers Builds: aresta-previa-relay",
      status: "completed",
      conclusion: "failure",
      details_url:
        "https://dash.cloudflare.com/634a6eddf09849caa3f28f6a5d7b53bb/workers/services/view/aresta-previa-relay/production/builds/123",
      head_sha: "f91cfbea771707fdc7e0a5bb177e50c7720934c2",
      app: { slug: "cloudflare-workers-and-pages" },
      check_suite: {
        head_branch: "main",
        head_commit: {
          message: "Atualiza worker de prévia",
          author: { name: "Renato" },
        },
      },
    },
  });
  const sigCf = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoFalhaCloudflare,
  );

  const resCf = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "check_run",
        "x-hub-signature-256": `sha256=${sigCf}`,
      },
      body: corpoFalhaCloudflare,
    }),
    env,
  );
  assertEquals(resCf.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(
    githubFake.issuesCriadas[0].repositorio,
    "aresta-climb/aresta_backend",
  );
  assertStringIncludes(
    githubFake.issuesCriadas[0].titulo,
    "Workers Builds: aresta-previa-relay",
  );
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(
    discordFake.mensagensEnviadas[0].urlWebhook,
    env.DISCORD_WEBHOOK_BUGS_URL,
  );
  assertStringIncludes(
    discordFake.mensagensEnviadas[0].texto,
    "https://dash.cloudflare.com/634a6eddf09849caa3f28f6a5d7b53bb/workers/services/view/aresta-previa-relay/production/builds/123",
  );

  // 2. check_run originado por github-actions deve ser ignorado (já coberto por workflow_run)
  const corpoCheckGithubActions = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_backend" },
    check_run: {
      name: "deploy",
      status: "completed",
      conclusion: "failure",
      app: { slug: "github-actions" },
      check_suite: { head_branch: "main" },
    },
  });
  const sigGha = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoCheckGithubActions,
  );

  const resGha = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "check_run",
        "x-hub-signature-256": `sha256=${sigGha}`,
      },
      body: corpoCheckGithubActions,
    }),
    env,
  );
  assertEquals(resGha.status, 200);
  assertEquals((await resGha.json()).ignorado, true);
  assertEquals(discordFake.mensagensEnviadas.length, 1);

  // 3. check_run com conclusion: "success" ou em branch secundária deve ser ignorado
  const corpoCheckSucesso = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/arestaclimb.com" },
    check_run: {
      name: "Cloudflare Pages",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/aresta-climb/arestaclimb.com/runs/1",
      app: { slug: "cloudflare-workers-and-pages" },
      check_suite: { head_branch: "main" },
    },
  });
  const sigOk = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoCheckSucesso,
  );
  const resOk = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "check_run",
        "x-hub-signature-256": `sha256=${sigOk}`,
      },
      body: corpoCheckSucesso,
    }),
    env,
  );
  assertEquals(resOk.status, 200);
  assertEquals((await resOk.json()).ignorado, true);
});

Deno.test("alertas-worker: roteia falha de commit status de deploy (Vercel) e workflow_run na branch master para Emergencias e ignora status pending/canceled", async () => {
  const discordFake = new ClienteDiscordFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteGithubApp = githubFake;

  // 1. Falha de deploy na Vercel via evento 'status' na branch master -> Emergência + Issue
  const corpoStatusVercelFalha = JSON.stringify({
    state: "failure",
    context: "Vercel",
    description:
      "Deployment has failed — run this Vercel CLI command: npx vercel inspect dpl_123 --logs",
    target_url:
      "https://vercel.com/aresta-climb/umami-analytics/7Y77zfvYfnCWrjRuu2uhA783mDDp",
    sha: "9120dffd1e60d70ce7122761a8e200c557fa63fe",
    repository: { full_name: "aresta-climb/umami" },
    branches: [{ name: "master" }],
    commit: {
      commit: {
        message: "Atualizar Umami automaticamente\nDetalhes extras",
        author: { name: "Renato Utsch" },
      },
    },
  });
  const sigVercel = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoStatusVercelFalha,
  );

  const resVercel = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "status",
        "x-hub-signature-256": `sha256=${sigVercel}`,
      },
      body: corpoStatusVercelFalha,
    }),
    env,
  );
  assertEquals(resVercel.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(githubFake.issuesCriadas[0].repositorio, "aresta-climb/umami");
  assertStringIncludes(githubFake.issuesCriadas[0].titulo, "Vercel (master)");
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(
    discordFake.mensagensEnviadas[0].urlWebhook,
    env.DISCORD_WEBHOOK_BUGS_URL,
  );
  assertStringIncludes(
    discordFake.mensagensEnviadas[0].texto,
    "https://vercel.com/aresta-climb/umami-analytics/7Y77zfvYfnCWrjRuu2uhA783mDDp",
  );

  // 2. Falha de workflow_run na branch 'master' (ex: sync.yml do umami) -> Emergência + Issue
  const corpoWorkflowMaster = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/umami" },
    workflow_run: {
      name: "Sincronizar com Upstream Oficial",
      head_branch: "master",
      conclusion: "failure",
      html_url:
        "https://github.com/aresta-climb/umami/actions/runs/40175328505",
      head_commit: {
        message: "Atualizar Umami automaticamente todo domingo",
        author: { name: "Renato Utsch" },
      },
    },
  });
  const sigWfMaster = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoWorkflowMaster,
  );

  const resWfMaster = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sigWfMaster}`,
      },
      body: corpoWorkflowMaster,
    }),
    env,
  );
  assertEquals(resWfMaster.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 2);
  assertEquals(discordFake.mensagensEnviadas.length, 2);

  // 3. Status 'pending', 'Canceled from the Vercel Dashboard' ou sem branch crítica deve ser ignorado
  for (
    const payloadIgnorado of [
      {
        state: "pending",
        context: "Vercel",
        description: "Vercel is deploying your app",
        repository: { full_name: "aresta-climb/umami" },
        branches: [{ name: "master" }],
      },
      {
        state: "failure",
        context: "Vercel",
        description: "Canceled from the Vercel Dashboard",
        repository: { full_name: "aresta-climb/umami" },
        branches: [{ name: "master" }],
      },
      {
        state: "error",
        context: "Vercel",
        description: "Preview build failed",
        repository: { full_name: "aresta-climb/umami" },
        branches: [{ name: "feature-preview" }],
      },
    ]
  ) {
    const corpoIgn = JSON.stringify(payloadIgnorado);
    const sigIgn = await assinarHmacSha256Hex(
      env.GITHUB_WEBHOOK_SECRET,
      corpoIgn,
    );
    const resIgn = await worker.fetch(
      new Request("https://alertas.arestaclimb.com/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "status",
          "x-hub-signature-256": `sha256=${sigIgn}`,
        },
        body: corpoIgn,
      }),
      env,
    );
    assertEquals(resIgn.status, 200);
    assertEquals((await resIgn.json()).ignorado, true);
  }
  assertEquals(discordFake.mensagensEnviadas.length, 2);
});

Deno.test("alertas-worker: cria GitHub Issue com label 'bug' para issue.created nao-fatal e com label 'emergencia' (+ alerta imediato) para issue.created fatal", async () => {
  const discordFake = new ClienteDiscordFake();
  const ntfyFake = new ClienteNtfyFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.NTFY_TOPICO_BUGS = "aresta-bugs-topico-oficial";
  env.NTFY_TOPICO_EMERGENCIAS = "aresta-emergencias-topico-oficial";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteNtfy = ntfyFake;
  env.clienteGithubApp = githubFake;

  // 1. Sentry envia issue.created (nível error) para o projeto aresta-app (ID 4512313345966080)
  const corpoIssueCreated = JSON.stringify({
    action: "created",
    data: {
      issue: {
        id: "7811812260",
        title: "StateError: Bad state: No element",
        level: "error",
        web_url: "https://aresta-climb.sentry.io/issues/7811812260/",
        project: {
          id: "4512313345966080",
          slug: "aresta-app",
          name: "aresta-app",
        },
      },
    },
  });
  const sigSentry = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoIssueCreated,
  );

  const resSentry = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigSentry,
        "sentry-hook-resource": "issue",
      },
      body: corpoIssueCreated,
    }),
    env,
  );
  assertEquals(resSentry.status, 200);
  const jsonSentry = await resSentry.json();
  assertEquals(jsonSentry.issueBugCriada, true);
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(
    githubFake.issuesCriadas[0].repositorio,
    "aresta-climb/aresta_app",
  );
  assertEquals(githubFake.issuesCriadas[0].labels, ["bug"]);
  assertStringIncludes(
    githubFake.issuesCriadas[0].corpo,
    "https://aresta-climb.sentry.io/issues/7811812260/",
  );

  // 2. Quando o GitHub dispara issues.opened para essa issue criada, envia ao NTFY_TOPICO_BUGS
  const corpoGithubOpened = JSON.stringify({
    action: "opened",
    repository: { full_name: "aresta-climb/aresta_app" },
    issue: {
      number: 1,
      title: githubFake.issuesCriadas[0].titulo,
      body: githubFake.issuesCriadas[0].corpo,
      html_url: "https://github.com/aresta-climb/aresta_app/issues/1",
      labels: [{ name: "bug" }],
    },
  });
  const sigGh = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoGithubOpened,
  );

  const resGh = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": `sha256=${sigGh}`,
      },
      body: corpoGithubOpened,
    }),
    env,
  );
  assertEquals(resGh.status, 200);
  assertEquals(ntfyFake.notificacoesEnviadas.length, 1);
  assertEquals(
    ntfyFake.notificacoesEnviadas[0].topico,
    "aresta-bugs-topico-oficial",
  );
  assertEquals(ntfyFake.notificacoesEnviadas[0].prioridade, 3);
  assertEquals(ntfyFake.notificacoesEnviadas[0].acoes?.length, 3);

  // 3. Sentry envia issue.created com level === "fatal" -> cria Issue com label 'emergencia' e notifica #emergencias + ntfy prioridade 5
  const corpoIssueFatalCreated = JSON.stringify({
    action: "created",
    data: {
      issue: {
        id: "7811899999",
        title: "UnhandledFatalException: Isolates crash",
        level: "fatal",
        web_url: "https://aresta-climb.sentry.io/issues/7811899999/",
        project: {
          id: "4512313378013184",
          slug: "aresta-backend",
          name: "aresta-backend",
        },
      },
    },
  });
  const sigFatalCreated = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoIssueFatalCreated,
  );

  const resFatalCreated = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigFatalCreated,
        "sentry-hook-resource": "issue",
      },
      body: corpoIssueFatalCreated,
    }),
    env,
  );
  assertEquals(resFatalCreated.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 2);
  assertEquals(
    githubFake.issuesCriadas[1].repositorio,
    "aresta-climb/aresta_backend",
  );
  assertEquals(githubFake.issuesCriadas[1].labels, ["emergencia"]);
  assertStringIncludes(
    githubFake.issuesCriadas[1].titulo,
    "UnhandledFatalException: Isolates crash",
  );
  assertEquals(ntfyFake.notificacoesEnviadas.length, 2);
  assertEquals(
    ntfyFake.notificacoesEnviadas[1].topico,
    "aresta-emergencias-topico-oficial",
  );
  assertEquals(ntfyFake.notificacoesEnviadas[1].prioridade, 5);
  assertEquals(ntfyFake.notificacoesEnviadas[1].acoes?.length, 3);
});


Deno.test("alertas-worker: classifica deploy.yml e erro interno de pr-*.yml do aresta_db como Emergencias, ignora recusa legitima de pr-*.yml e classifica demais workflows como Bugs", async () => {
  const discordFake = new ClienteDiscordFake();
  const ntfyFake = new ClienteNtfyFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.NTFY_TOPICO_BUGS = "aresta-bugs-topico-oficial";
  env.NTFY_TOPICO_EMERGENCIAS = "aresta-emergencias-topico-oficial";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteNtfy = ntfyFake;
  env.clienteGithubApp = githubFake;

  // 1. Falha de workflow geral (ex: build_editor_linux.yml em aresta_db na main) -> Bug (issue 'bug' + #bugs + ntfy prioridade 3)
  const corpoWfGeral = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_db" },
    workflow_run: {
      id: 1001,
      name: "Build Editor Linux",
      path: ".github/workflows/build_editor_linux.yml",
      head_branch: "main",
      conclusion: "failure",
      html_url: "https://github.com/aresta-climb/aresta_db/actions/runs/1001",
      head_commit: {
        message: "chore: atualizar dependencias linux",
        author: { name: "Renato" },
      },
    },
  });
  const sigWfGeral = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoWfGeral,
  );
  const resWfGeral = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sigWfGeral}`,
      },
      body: corpoWfGeral,
    }),
    env,
  );
  assertEquals(resWfGeral.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(githubFake.issuesCriadas[0].labels, ["bug"]);
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(
    discordFake.mensagensEnviadas[0].urlWebhook,
    env.DISCORD_WEBHOOK_BUGS_URL,
  );
  assertEquals(ntfyFake.notificacoesEnviadas.length, 1);
  assertEquals(ntfyFake.notificacoesEnviadas[0].prioridade, 3);

  // 2. Falha no deploy.yml do aresta_db -> Emergência (issue 'emergencia' + #emergencias + ntfy prioridade 5)
  const corpoDeployDb = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_db" },
    workflow_run: {
      id: 1002,
      name: "Deploy para Cloudflare R2 e D1",
      path: ".github/workflows/deploy.yml",
      head_branch: "main",
      conclusion: "failure",
      html_url: "https://github.com/aresta-climb/aresta_db/actions/runs/1002",
      head_commit: {
        message: "feat: publicar novos croquis",
        author: { name: "Renato" },
      },
    },
  });
  const sigDeployDb = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoDeployDb,
  );
  const resDeployDb = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sigDeployDb}`,
      },
      body: corpoDeployDb,
    }),
    env,
  );
  assertEquals(resDeployDb.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 2);
  assertEquals(githubFake.issuesCriadas[1].labels, ["emergencia"]);
  assertEquals(discordFake.mensagensEnviadas.length, 2);
  assertEquals(
    discordFake.mensagensEnviadas[1].urlWebhook,
    env.DISCORD_WEBHOOK_EMERGENCIAS_URL,
  );
  assertEquals(ntfyFake.notificacoesEnviadas.length, 2);
  assertEquals(ntfyFake.notificacoesEnviadas[1].prioridade, 5);

  // 3. Falha em pr-db-validator.yml apenas no step 'Run Validator' (recusa legítima de PR) -> Ignorado!
  githubFake.definirStepsFalhosWorkflowRun(1003, ["Run Validator"]);
  const corpoPrRecusaLegitima = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_db" },
    workflow_run: {
      id: 1003,
      name: "Validador do Database (PR)",
      path: ".github/workflows/pr-db-validator.yml",
      head_branch: "submissao/croqui-cipo",
      conclusion: "failure",
      html_url: "https://github.com/aresta-climb/aresta_db/actions/runs/1003",
      head_commit: {
        message: "submissao de croqui com erro de schema",
        author: { name: "Colaborador" },
      },
    },
  });
  const sigPrRecusa = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoPrRecusaLegitima,
  );
  const resPrRecusa = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sigPrRecusa}`,
      },
      body: corpoPrRecusaLegitima,
    }),
    env,
  );
  assertEquals(resPrRecusa.status, 200);
  assertEquals((await resPrRecusa.json()).ignorado, true);
  assertEquals(githubFake.issuesCriadas.length, 2);
  assertEquals(discordFake.mensagensEnviadas.length, 2);

  // 4. Falha em pr-db-validator.yml com step 'Erro Interno no Script de Validação' (exit code >= 2) ou 'Generate Github App Token' -> Emergência!
  githubFake.definirStepsFalhosWorkflowRun(1004, [
    "Run Validator",
    "Erro Interno no Script de Validação",
  ]);
  const corpoPrErroInterno = JSON.stringify({
    action: "completed",
    repository: { full_name: "aresta-climb/aresta_db" },
    workflow_run: {
      id: 1004,
      name: "Validador do Database (PR)",
      path: ".github/workflows/pr-db-validator.yml",
      head_branch: "submissao/croqui-cipo",
      conclusion: "failure",
      html_url: "https://github.com/aresta-climb/aresta_db/actions/runs/1004",
      head_commit: {
        message: "submissao de croqui",
        author: { name: "Colaborador" },
      },
    },
  });
  const sigPrErroInterno = await assinarHmacSha256Hex(
    env.GITHUB_WEBHOOK_SECRET,
    corpoPrErroInterno,
  );
  const resPrErroInterno = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "workflow_run",
        "x-hub-signature-256": `sha256=${sigPrErroInterno}`,
      },
      body: corpoPrErroInterno,
    }),
    env,
  );
  assertEquals(resPrErroInterno.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 3);
  assertEquals(githubFake.issuesCriadas[2].labels, ["emergencia"]);
  assertEquals(discordFake.mensagensEnviadas.length, 3);
  assertEquals(
    discordFake.mensagensEnviadas[2].urlWebhook,
    env.DISCORD_WEBHOOK_EMERGENCIAS_URL,
  );
  assertEquals(ntfyFake.notificacoesEnviadas.length, 3);
  assertEquals(ntfyFake.notificacoesEnviadas[2].prioridade, 5);
});

Deno.test("alertas-worker: enfileira criacao de issue de bug nao-fatal do Sentry na FILA_RETENTATIVAS_ALERTAS e notifica Discord e ntfy imediatamente em caso de outage do GitHub", async () => {
  const discordFake = new ClienteDiscordFake();
  const ntfyFake = new ClienteNtfyFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const filaFake = new FilaRetentativasFake();

  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.NTFY_TOPICO_BUGS = "aresta-bugs-topico-oficial";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteNtfy = ntfyFake;
  env.clienteGithubApp = githubFake;
  env.filaRetentativas = filaFake;

  // Simula outage no GitHub
  githubFake.deveFalhar = true;

  const corpoIssueNaoFatal = JSON.stringify({
    action: "created",
    data: {
      issue: {
        id: "7899999999",
        title: "HttpException: Connection closed before full header was received",
        level: "error",
        web_url: "https://aresta-climb.sentry.io/issues/7899999999/",
        project: {
          id: "4512313384239104",
          slug: "aresta-backend",
          name: "aresta-backend",
        },
      },
    },
  });
  const sigSentry = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoIssueNaoFatal,
  );

  const res = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sigSentry,
        "sentry-hook-resource": "issue",
      },
      body: corpoIssueNaoFatal,
    }),
    env,
  );
  assertEquals(res.status, 200);

  // Mesmo com o GitHub fora do ar, notificou imediatamente no Discord (#bugs) e no ntfy (prioridade 3)
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(
    discordFake.mensagensEnviadas[0].urlWebhook,
    env.DISCORD_WEBHOOK_BUGS_URL,
  );
  assertEquals(ntfyFake.notificacoesEnviadas.length, 1);
  assertEquals(
    ntfyFake.notificacoesEnviadas[0].topico,
    "aresta-bugs-topico-oficial",
  );
  assertEquals(ntfyFake.notificacoesEnviadas[0].prioridade, 3);

  // E enfileirou a criação da issue 'bug' na fila KV de retentativas
  const pendentes = await filaFake.listarPendentes();
  assertEquals(pendentes.length, 1);
  assertEquals(pendentes[0].tipo, "criar_issue_emergencia");
  assertEquals(pendentes[0].dadosIssue?.labels, ["bug"]);
  assertEquals(
    pendentes[0].dadosIssue?.repositorio,
    "aresta-climb/aresta_backend",
  );

  // Quando o GitHub volta no Cron Trigger, a issue é criada e removida da fila
  githubFake.deveFalhar = false;
  await processarFilaRetentativas(env);
  assertEquals((await filaFake.listarPendentes()).length, 0);
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(githubFake.issuesCriadas[0].labels, ["bug"]);
});

Deno.test("alertas-worker: ao receber issue.unresolved (regressao no Sentry), reabre issue fechada existente ou cria nova Issue ('bug' ou 'emergencia') se nenhuma existir no GitHub", async () => {
  const discordFake = new ClienteDiscordFake();
  const ntfyFake = new ClienteNtfyFake();
  const githubFake = new ClienteGithubAppFake();
  const resendFake = new ClienteResendFake();
  const env = criarAmbientePadrao(undefined, resendFake, discordFake);
  env.CANAL_ALERTAS_ATIVO = "discord";
  env.NTFY_TOPICO_BUGS = "aresta-bugs-topico-oficial";
  env.NTFY_TOPICO_EMERGENCIAS = "aresta-emergencias-topico-oficial";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID = "app-id";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY = "key";
  env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID = "123";
  env.clienteNtfy = ntfyFake;
  env.clienteGithubApp = githubFake;

  // 1. Cenário A (ex: ARESTA-APP-7): Issue já existe fechada no GitHub -> reabre (issuesEncontradas: 1, issuesAtualizadas: 1) e NÃO cria duplicata
  githubFake.definirResultadoSincronizacaoPorIdSentry("7817750322", {
    issuesEncontradas: 1,
    issuesAtualizadas: 1,
  });
  const corpoRegressaoComIssueFechada = JSON.stringify({
    action: "unresolved",
    data: {
      issue: {
        id: "7817750322",
        title: "FirebaseException: [firebase_app_check/unknown] Error returned from API. code: 403 body: App attestation failed.",
        level: "error",
        substatus: "regressed",
        web_url: "https://aresta-climb.sentry.io/issues/7817750322/",
        project: { slug: "aresta-app" },
      },
    },
  });
  const sig1 = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoRegressaoComIssueFechada,
  );
  const res1 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sig1,
        "sentry-hook-resource": "issue",
      },
      body: corpoRegressaoComIssueFechada,
    }),
    env,
  );
  assertEquals(res1.status, 200);
  const json1 = await res1.json();
  assertEquals(json1.sincronizadoGithub, true);
  assertEquals(json1.issuesAtualizadas, 1);
  assertEquals(githubFake.issuesCriadas.length, 0);

  // 2. Cenário B (Anti-duplicata): Issue já existe ABERTA no GitHub (issuesEncontradas: 1, issuesAtualizadas: 0) -> NÃO cria duplicata
  githubFake.definirResultadoSincronizacaoPorIdSentry("7817755115", {
    issuesEncontradas: 1,
    issuesAtualizadas: 0,
  });
  const corpoUnresolvedJaAberta = JSON.stringify({
    action: "unresolved",
    data: {
      issue: {
        id: "7817755115",
        title: "FirebaseException: [firebase_app_check/unknown] Too many attempts.",
        level: "error",
        web_url: "https://aresta-climb.sentry.io/issues/7817755115/",
        project: { slug: "aresta-app" },
      },
    },
  });
  const sig2 = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoUnresolvedJaAberta,
  );
  const res2 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sig2,
        "sentry-hook-resource": "issue",
      },
      body: corpoUnresolvedJaAberta,
    }),
    env,
  );
  assertEquals(res2.status, 200);
  const json2 = await res2.json();
  assertEquals(json2.sincronizadoGithub, true);
  assertEquals(json2.issuesAtualizadas, 0);
  assertEquals(githubFake.issuesCriadas.length, 0);

  // 3. Cenário C (ex: ARESTA-APP-3): Issue não-fatal regride no Sentry e NÃO possui Issue no GitHub (issuesEncontradas: 0) -> cria nova Issue com label 'bug'
  githubFake.definirResultadoSincronizacaoPorIdSentry("7810000003", {
    issuesEncontradas: 0,
    issuesAtualizadas: 0,
  });
  const corpoRegressaoSemIssue = JSON.stringify({
    action: "unresolved",
    data: {
      issue: {
        id: "7810000003",
        title: "_Exception: Exception: HTTP Status 403 - Resposta: {\"error\":\"Acesso negado: Token de atestação do App Check ausente.\"}",
        level: "error",
        substatus: "regressed",
        web_url: "https://aresta-climb.sentry.io/issues/7810000003/",
        project: { slug: "aresta-app" },
      },
    },
  });
  const sig3 = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoRegressaoSemIssue,
  );
  const res3 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sig3,
        "sentry-hook-resource": "issue",
      },
      body: corpoRegressaoSemIssue,
    }),
    env,
  );
  assertEquals(res3.status, 200);
  const json3 = await res3.json();
  assertEquals(json3.issueBugCriada, true);
  assertEquals(githubFake.issuesCriadas.length, 1);
  assertEquals(githubFake.issuesCriadas[0].repositorio, "aresta-climb/aresta_app");
  assertEquals(githubFake.issuesCriadas[0].labels, ["bug"]);
  assertStringIncludes(
    githubFake.issuesCriadas[0].corpo,
    "https://aresta-climb.sentry.io/issues/7810000003/",
  );

  // 4. Cenário D: Issue FATAL regride no Sentry e NÃO possui Issue no GitHub (issuesEncontradas: 0) -> cria nova Issue 'emergencia' e notifica Discord + ntfy
  githubFake.definirResultadoSincronizacaoPorIdSentry("7810000999", {
    issuesEncontradas: 0,
    issuesAtualizadas: 0,
  });
  const corpoRegressaoFatalSemIssue = JSON.stringify({
    action: "unresolved",
    data: {
      issue: {
        id: "7810000999",
        title: "FatalCrash: Native segmentation fault",
        level: "fatal",
        substatus: "regressed",
        web_url: "https://aresta-climb.sentry.io/issues/7810000999/",
        project: { slug: "aresta-app" },
      },
    },
  });
  const sig4 = await assinarHmacSha256Hex(
    env.SENTRY_WEBHOOK_SECRET,
    corpoRegressaoFatalSemIssue,
  );
  const res4 = await worker.fetch(
    new Request("https://alertas.arestaclimb.com/webhook/sentry", {
      method: "POST",
      headers: {
        "sentry-hook-signature": sig4,
        "sentry-hook-resource": "issue",
      },
      body: corpoRegressaoFatalSemIssue,
    }),
    env,
  );
  assertEquals(res4.status, 200);
  assertEquals(githubFake.issuesCriadas.length, 2);
  assertEquals(githubFake.issuesCriadas[1].labels, ["emergencia"]);
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(
    discordFake.mensagensEnviadas[0].urlWebhook,
    env.DISCORD_WEBHOOK_EMERGENCIAS_URL,
  );
  assertEquals(ntfyFake.notificacoesEnviadas.length, 1);
  assertEquals(ntfyFake.notificacoesEnviadas[0].prioridade, 5);
});
