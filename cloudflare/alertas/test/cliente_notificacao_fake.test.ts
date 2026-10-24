// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ClienteResendFake,
  ClienteWahaFake,
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
