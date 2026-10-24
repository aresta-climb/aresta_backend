// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "@std/assert";
import { RelatorSentryFake } from "./relator_sentry_fake.ts";

Deno.test("RelatorSentryFake: armazena evento com cabecalhos sanitizados e agenda em waitUntil", async () => {
  const fake = new RelatorSentryFake();
  const promessasWaitUntil: Promise<unknown>[] = [];

  const req = new Request("https://catalogo.arestaclimb.com/sync", {
    method: "GET",
    headers: {
      "Authorization": "Bearer token-secreto",
      "Cookie": "sessao=123",
      "x-api-key": "chave-privada",
      "User-Agent": "ArestaApp/0.5.6",
    },
  });

  const enviou = await fake.relatarErro(new Error("Falha no banco D1"), {
    dsn: "https://public@o1.ingest.sentry.io/123",
    servico: "catalogo-worker",
    ambiente: "teste",
    requisicao: req,
    tags: { regiao: "gru" },
    extras: { tentativa: 2 },
    contextoExecucao: {
      waitUntil(p) {
        promessasWaitUntil.push(p);
      },
    },
  });

  assertEquals(enviou, true);
  assertEquals(promessasWaitUntil.length, 1);
  assertEquals(fake.eventos.length, 1);

  const ev = fake.eventos[0];
  assertEquals(ev.mensagem, "Falha no banco D1");
  assertEquals(ev.servico, "catalogo-worker");
  assertEquals(ev.ambiente, "teste");
  assertEquals(ev.urlRequisicao, "https://catalogo.arestaclimb.com/sync");
  assertEquals(ev.metodoRequisicao, "GET");
  assertEquals(ev.cabecalhosSanitizados?.["authorization"], "[REDACTED]");
  assertEquals(ev.cabecalhosSanitizados?.["cookie"], "[REDACTED]");
  assertEquals(ev.cabecalhosSanitizados?.["x-api-key"], "[REDACTED]");
  assertEquals(ev.cabecalhosSanitizados?.["user-agent"], "ArestaApp/0.5.6");
  assertEquals(ev.tags, { regiao: "gru" });
  assertEquals(ev.extras, { tentativa: 2 });
});

Deno.test("RelatorSentryFake: ignora envio quando DSN esta vazio e respeita simularFalhaRede e limpar", async () => {
  const fake = new RelatorSentryFake();

  const semDsn = await fake.relatarErro("Erro texto simples", {
    dsn: "   ",
    servico: "git-proxy",
  });
  assertEquals(semDsn, false);
  assertEquals(fake.eventos.length, 0);

  fake.simularFalhaRede = true;
  const comFalha = await fake.relatarErro("Erro texto simples", {
    dsn: "https://public@o1.ingest.sentry.io/123",
    servico: "git-proxy",
  });
  assertEquals(comFalha, false);
  assertEquals(fake.eventos.length, 0);

  fake.limpar();
  const aposLimpar = await fake.relatarErro("Erro texto simples", {
    dsn: "https://public@o1.ingest.sentry.io/123",
    servico: "git-proxy",
  });
  assertEquals(aposLimpar, true);
  assertEquals(fake.eventos.length, 1);
  assertEquals(fake.eventos[0].mensagem, "Erro texto simples");
  assertEquals(fake.eventos[0].ambiente, "producao");
});
