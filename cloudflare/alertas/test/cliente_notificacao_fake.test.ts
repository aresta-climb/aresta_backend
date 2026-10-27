// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ClienteDiscordFake,
  ClienteGithubAppFake,
  ClienteNtfyFake,
  ClienteResendFake,
  ClienteSentryFake,
  ClienteWahaFake,
  FilaRetentativasFake,
} from "../src/cliente_notificacao_fake.ts";

Deno.test("ClienteWahaFake: registra mensagens enviadas com sessao default e permite limpar estado", async () => {
  const wahaFake = new ClienteWahaFake();

  const resultado = await wahaFake.enviarMensagemGrupo({
    urlBase: "https://waha.arestaclimb.com",
    chaveApi: "chave-secreta",
    chatId: "120363000001@g.us",
    texto: "🚨 Alerta de teste",
  });

  assertEquals(resultado.sucesso, true);
  assertEquals(resultado.statusHttp, 201);
  assertEquals(wahaFake.mensagensEnviadas.length, 1);
  assertEquals(wahaFake.mensagensEnviadas[0].sessao, "default");
  assertEquals(wahaFake.mensagensEnviadas[0].chatId, "120363000001@g.us");

  wahaFake.limpar();
  assertEquals(wahaFake.mensagensEnviadas.length, 0);
});

Deno.test("ClienteWahaFake: simula falha deterministica quando deveFalhar esta ativo", async () => {
  const wahaFake = new ClienteWahaFake();
  wahaFake.deveFalhar = true;
  wahaFake.statusFalha = 504;
  wahaFake.mensagemFalha = "Timeout no Cloudflare Tunnel";

  const resultado = await wahaFake.enviarMensagemGrupo({
    urlBase: "https://waha.arestaclimb.com",
    chaveApi: "chave-secreta",
    chatId: "120363000001@g.us",
    texto: "🚨 Alerta",
    sessao: "principal",
  });

  assertEquals(resultado.sucesso, false);
  assertEquals(resultado.statusHttp, 504);
  assertEquals(resultado.erro, "Timeout no Cloudflare Tunnel");
  assertEquals(wahaFake.mensagensEnviadas.length, 0);
});

Deno.test("ClienteResendFake: registra e-mails de contingencia e permite simular falha e limpeza", async () => {
  const resendFake = new ClienteResendFake();

  const resSucesso = await resendFake.enviarEmailFallback({
    chaveApi: "re_123",
    remetente: "alerta@login.arestaclimb.com",
    destinatario: "contato@arestaclimb.com",
    assunto: "[CONTINGÊNCIA WHATSAPP] 🚨 Emergência",
    texto: "Conteúdo do alerta",
    motivoFalhaWaha: "HTTP 502",
  });

  assertEquals(resSucesso.sucesso, true);
  assertEquals(resSucesso.statusHttp, 200);
  assertEquals(resSucesso.idEmail, "email-fake-1");
  assertEquals(resendFake.emailsEnviados.length, 1);
  assertEquals(resendFake.emailsEnviados[0].destinatario, "contato@arestaclimb.com");

  resendFake.deveFalhar = true;
  resendFake.statusFalha = 429;

  const resFalha = await resendFake.enviarEmailFallback({
    chaveApi: "re_123",
    remetente: "alerta@login.arestaclimb.com",
    destinatario: "contato@arestaclimb.com",
    assunto: "Assunto",
    texto: "Texto",
    motivoFalhaWaha: "Timeout",
  });

  assertEquals(resFalha.sucesso, false);
  assertEquals(resFalha.statusHttp, 429);
  assertEquals(resendFake.emailsEnviados.length, 1);

  resendFake.limpar();
  assertEquals(resendFake.emailsEnviados.length, 0);
  assertEquals(resendFake.deveFalhar, false);
});

Deno.test("ClienteDiscordFake: registra mensagens de webhook enviadas e permite simular falha deterministica e limpeza", async () => {
  const discordFake = new ClienteDiscordFake();

  const resSucesso = await discordFake.enviarMensagemWebhook({
    urlWebhook: "https://discord.com/api/webhooks/123/abc",
    texto: "@everyone 🚨 Teste de emergência",
  });

  assertEquals(resSucesso.sucesso, true);
  assertEquals(resSucesso.statusHttp, 200);
  assertEquals(resSucesso.urlMensagem, "https://discord.com/channels/1000/2000/3001");
  assertEquals(discordFake.mensagensEnviadas.length, 1);
  assertEquals(discordFake.mensagensEnviadas[0].urlWebhook, "https://discord.com/api/webhooks/123/abc");
  assertEquals(discordFake.mensagensEnviadas[0].texto, "@everyone 🚨 Teste de emergência");

  discordFake.deveFalhar = true;
  discordFake.statusFalha = 429;
  discordFake.mensagemFalha = "Rate limit excedido no Discord";

  const resFalha = await discordFake.enviarMensagemWebhook({
    urlWebhook: "https://discord.com/api/webhooks/123/abc",
    texto: "Outra mensagem",
  });

  assertEquals(resFalha.sucesso, false);
  assertEquals(resFalha.statusHttp, 429);
  assertEquals(resFalha.erro, "Rate limit excedido no Discord");
  assertEquals(discordFake.mensagensEnviadas.length, 1);

  discordFake.limpar();
  assertEquals(discordFake.mensagensEnviadas.length, 0);
  assertEquals(discordFake.deveFalhar, false);
});

Deno.test("ClienteGithubAppFake: registra criacao e sincronizacao de issues e permite simular falhas e limpeza", async () => {
  const githubFake = new ClienteGithubAppFake();

  const resCriacao = await githubFake.criarIssueEmergencia({
    clientId: "client-id",
    privateKey: "private-key",
    installationId: "12345",
    repositorio: "aresta-climb/aresta_backend",
    titulo: "🚨 [EMERGÊNCIA] Crash fatal no worker",
    corpo: "Detalhes do erro: https://aresta-climb.sentry.io/issues/999/",
    labels: ["emergencia"],
  });

  assertEquals(resCriacao.sucesso, true);
  assertEquals(resCriacao.statusHttp, 201);
  assertEquals(resCriacao.numeroIssue, 1);
  assertEquals(resCriacao.urlIssue, "https://github.com/aresta-climb/aresta_backend/issues/1");
  assertEquals(githubFake.issuesCriadas.length, 1);

  const resSync = await githubFake.sincronizarEstadoIssuePorIdSentry({
    clientId: "client-id",
    privateKey: "private-key",
    installationId: "12345",
    idIssueSentry: "999",
    novoEstado: "closed",
  });

  assertEquals(resSync.sucesso, true);
  assertEquals(resSync.statusHttp, 200);
  assertEquals(resSync.issuesAtualizadas, 1);
  assertEquals(githubFake.sincronizacoesEstado.length, 1);
  assertEquals(githubFake.sincronizacoesEstado[0].novoEstado, "closed");

  githubFake.deveFalhar = true;
  githubFake.statusFalha = 503;
  githubFake.mensagemFalha = "GitHub API fora do ar";

  const resFalhaCriacao = await githubFake.criarIssueEmergencia({
    clientId: "client-id",
    privateKey: "private-key",
    installationId: "12345",
    repositorio: "aresta-climb/aresta_app",
    titulo: "Erro",
    corpo: "Corpo",
    labels: ["emergencia"],
  });
  assertEquals(resFalhaCriacao.sucesso, false);
  assertEquals(resFalhaCriacao.statusHttp, 503);
  assertEquals(resFalhaCriacao.erro, "GitHub API fora do ar");

  const resFalhaSync = await githubFake.sincronizarEstadoIssuePorIdSentry({
    clientId: "client-id",
    privateKey: "private-key",
    installationId: "12345",
    idIssueSentry: "999",
    novoEstado: "open",
  });
  assertEquals(resFalhaSync.sucesso, false);
  assertEquals(resFalhaSync.statusHttp, 503);

  const resFalhaSteps = await githubFake.obterStepsFalhosWorkflowRun({
    clientId: "client-id",
    privateKey: "private-key",
    installationId: "12345",
    repositorio: "aresta-climb/aresta_db",
    runId: 500,
  });
  assertEquals(resFalhaSteps.sucesso, false);
  assertEquals(resFalhaSteps.statusHttp, 503);

  githubFake.limpar();
  githubFake.definirStepsFalhosWorkflowRun(500, ["Run Validator"]);
  const resStepsOk = await githubFake.obterStepsFalhosWorkflowRun({
    clientId: "client-id",
    privateKey: "private-key",
    installationId: "12345",
    repositorio: "aresta-climb/aresta_db",
    runId: 500,
  });
  assertEquals(resStepsOk.sucesso, true);
  assertEquals(resStepsOk.nomesStepsFalhos, ["Run Validator"]);
  assertEquals(githubFake.consultasStepsWorkflow.length, 1);

  githubFake.limpar();
  assertEquals(githubFake.issuesCriadas.length, 0);
  assertEquals(githubFake.sincronizacoesEstado.length, 0);
  assertEquals(githubFake.consultasStepsWorkflow.length, 0);
  assertEquals(githubFake.deveFalhar, false);
});

Deno.test("ClienteSentryFake: registra atualizacoes de status resolved/unresolved e permite simular falha e limpeza", async () => {
  const sentryFake = new ClienteSentryFake();

  const resSucesso = await sentryFake.atualizarStatusIssue({
    tokenApi: "sntrys_token",
    idIssueSentry: "888",
    novoStatus: "resolved",
  });

  assertEquals(resSucesso.sucesso, true);
  assertEquals(resSucesso.statusHttp, 200);
  assertEquals(sentryFake.atualizacoesStatus.length, 1);
  assertEquals(sentryFake.atualizacoesStatus[0].idIssueSentry, "888");
  assertEquals(sentryFake.atualizacoesStatus[0].novoStatus, "resolved");

  sentryFake.deveFalhar = true;
  sentryFake.statusFalha = 500;
  sentryFake.mensagemFalha = "Sentry API indisponível";

  const resFalha = await sentryFake.atualizarStatusIssue({
    tokenApi: "sntrys_token",
    idIssueSentry: "888",
    novoStatus: "unresolved",
  });
  assertEquals(resFalha.sucesso, false);
  assertEquals(resFalha.statusHttp, 500);
  assertEquals(resFalha.erro, "Sentry API indisponível");

  sentryFake.limpar();
  assertEquals(sentryFake.atualizacoesStatus.length, 0);
  assertEquals(sentryFake.deveFalhar, false);
});

Deno.test("FilaRetentativasFake: enfileira, lista e remove itens pendentes em memoria", async () => {
  const filaFake = new FilaRetentativasFake();

  await filaFake.enfileirar({
    id: "item-1",
    tipo: "criar_issue_emergencia",
    criadoEmIso: "2026-10-25T12:00:00.000Z",
    tentativas: 1,
    dadosIssue: {
      repositorio: "aresta-climb/aresta_backend",
      titulo: "🚨 Emergência",
      corpo: "Corpo",
      labels: ["emergencia"],
      textoAlertaBase: "🚨 Emergência",
    },
  });

  const pendentes = await filaFake.listarPendentes();
  assertEquals(pendentes.length, 1);
  assertEquals(pendentes[0].id, "item-1");

  await filaFake.remover("item-1");
  assertEquals((await filaFake.listarPendentes()).length, 0);

  await filaFake.enfileirar({
    id: "item-2",
    tipo: "enviar_notificacao_discord",
    criadoEmIso: "2026-10-25T12:01:00.000Z",
    tentativas: 1,
    dadosDiscord: {
      categoria: "emergencias",
      texto: "🚨 Alerta pendente",
    },
  });
  filaFake.limpar();
  assertEquals((await filaFake.listarPendentes()).length, 0);
});

Deno.test("ClienteNtfyFake: registra notificacoes push com prioridade, icone e acoes e permite simular falha e limpeza", async () => {
  const ntfyFake = new ClienteNtfyFake();

  const resSucesso = await ntfyFake.enviarNotificacaoPush({
    urlBase: "https://ntfy.sh",
    topico: "aresta-emergencias-123",
    titulo: "Aresta Climb • 🚨 [EMERGÊNCIA] Crash Fatal",
    mensagem: "Detalhes do crash",
    prioridade: 5,
    tags: ["rotating_light", "emergencia"],
    iconeUrl: "https://alertas.arestaclimb.com/icones/emergencia.webp",
    urlClique: "https://github.com/aresta-climb/aresta_backend/issues/1",
    acoes: [
      {
        action: "view",
        label: "Abrir no GitHub",
        url: "https://github.com/aresta-climb/aresta_backend/issues/1",
      },
    ],
    tokenApi: "tk_secreto",
  });

  assertEquals(resSucesso.sucesso, true);
  assertEquals(resSucesso.statusHttp, 200);
  assertEquals(ntfyFake.notificacoesEnviadas.length, 1);
  assertEquals(ntfyFake.notificacoesEnviadas[0].prioridade, 5);
  assertEquals(
    ntfyFake.notificacoesEnviadas[0].iconeUrl,
    "https://alertas.arestaclimb.com/icones/emergencia.webp",
  );

  ntfyFake.deveFalhar = true;
  ntfyFake.statusFalha = 502;
  ntfyFake.mensagemFalha = "ntfy indisponível";

  const resFalha = await ntfyFake.enviarNotificacaoPush({
    urlBase: "https://ntfy.sh",
    topico: "aresta-bugs-123",
    titulo: "Bug",
    mensagem: "Detalhe",
    prioridade: 3,
  });
  assertEquals(resFalha.sucesso, false);
  assertEquals(resFalha.statusHttp, 502);
  assertEquals(resFalha.erro, "ntfy indisponível");

  ntfyFake.limpar();
  assertEquals(ntfyFake.notificacoesEnviadas.length, 0);
  assertEquals(ntfyFake.deveFalhar, false);
});
