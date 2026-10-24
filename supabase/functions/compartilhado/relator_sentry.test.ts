// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "@std/assert";
import {
  extrairConfiguracaoDsn,
  extrairFramesPilha,
  RelatorSentry,
  relatarErroSentry,
} from "./relator_sentry.ts";

Deno.test("extrairConfiguracaoDsn: extrai URL de envelope a partir de DSN valido e retorna null para invalidos", () => {
  const config = extrairConfiguracaoDsn("https://chavePublica123@o456.ingest.us.sentry.io/789012");
  assertEquals(config, {
    dsn: "https://chavePublica123@o456.ingest.us.sentry.io/789012",
    chavePublica: "chavePublica123",
    idProjeto: "789012",
    urlEnvelope: "https://o456.ingest.us.sentry.io/api/789012/envelope/",
  });

  assertEquals(extrairConfiguracaoDsn(""), null);
  assertEquals(extrairConfiguracaoDsn("url-invalida"), null);
  assertEquals(extrairConfiguracaoDsn("https://sem-usuario.sentry.io/123"), null);
  assertEquals(extrairConfiguracaoDsn("https://chave@o1.ingest.sentry.io/"), null);
});

Deno.test("extrairFramesPilha: converte linhas V8/Deno de stack trace em frames ordenados do mais antigo ao mais recente", () => {
  const stack = [
    "Error: Falha critica",
    "    at consultarBanco (file:///app/src/banco.ts:42:15)",
    "    at file:///app/src/index.ts:108:3",
    "    at linhaSemFormatoPadrao",
  ].join("\n");

  const frames = extrairFramesPilha(stack);
  assertEquals(frames.length, 2);
  // Sentry espera frames na ordem caller -> callee (inverso da stack do V8)
  assertEquals(frames[0], {
    filename: "file:///app/src/index.ts",
    function: "<anonymous>",
    lineno: 108,
    colno: 3,
    in_app: true,
  });
  assertEquals(frames[1], {
    filename: "file:///app/src/banco.ts",
    function: "consultarBanco",
    lineno: 42,
    colno: 15,
    in_app: true,
  });
  assertEquals(extrairFramesPilha(undefined), []);
});

Deno.test("RelatorSentry: monta envelope valido, sanitiza cabecalhos sensiveis e agenda em waitUntil", async () => {
  let urlChamada = "";
  let corpoEnvelope = "";
  let contentType = "";
  const promessasWaitUntil: Promise<unknown>[] = [];

  const fetchDeterministico: typeof fetch = (input, init) => {
    urlChamada = String(input);
    corpoEnvelope = String(init?.body ?? "");
    const headers = new Headers(init?.headers);
    contentType = headers.get("content-type") ?? "";
    return Promise.resolve(new Response("{}", { status: 200 }));
  };

  const req = new Request("https://api.arestaclimb.com/v1/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer segredo-jwt",
      "Cookie": "token=abc",
      "x-api-key": "12345",
      "Content-Type": "application/json",
    },
  });

  const erro = new TypeError("Propriedade indefinida");
  const relator = new RelatorSentry();
  const sucesso = await relator.relatarErro(erro, {
    dsn: "https://pubKey@o99.ingest.sentry.io/42",
    servico: "create-pr",
    ambiente: "staging",
    requisicao: req,
    tags: { modulo: "github" },
    extras: { branch: "sugestao-1" },
    fetchFn: fetchDeterministico,
    contextoExecucao: {
      waitUntil(p) {
        promessasWaitUntil.push(p);
      },
    },
  });

  assertEquals(sucesso, true);
  assertEquals(promessasWaitUntil.length, 1);
  assertEquals(urlChamada, "https://o99.ingest.sentry.io/api/42/envelope/");
  assertEquals(contentType, "application/x-sentry-envelope");

  const linhas = corpoEnvelope.trim().split("\n");
  assertEquals(linhas.length, 3);

  const cabecalhoEnvelope = JSON.parse(linhas[0]);
  assertEquals(cabecalhoEnvelope.dsn, "https://pubKey@o99.ingest.sentry.io/42");

  const cabecalhoItem = JSON.parse(linhas[1]);
  assertEquals(cabecalhoItem.type, "event");

  const payload = JSON.parse(linhas[2]);
  assertEquals(payload.level, "error");
  assertEquals(payload.environment, "staging");
  assertEquals(payload.tags.servico, "create-pr");
  assertEquals(payload.tags.modulo, "github");
  assertEquals(payload.extra.branch, "sugestao-1");
  assertEquals(payload.exception.values[0].type, "TypeError");
  assertEquals(payload.exception.values[0].value, "Propriedade indefinida");
  assertEquals(payload.request.url, "https://api.arestaclimb.com/v1/create-pr");
  assertEquals(payload.request.method, "POST");
  assertEquals(payload.request.headers["authorization"], "[REDACTED]");
  assertEquals(payload.request.headers["cookie"], "[REDACTED]");
  assertEquals(payload.request.headers["x-api-key"], "[REDACTED]");
  assertEquals(payload.request.headers["content-type"], "application/json");
});

Deno.test("relatarErroSentry: opera em modo no-op sem DSN e captura falhas HTTP/rede sem lancar excecao", async () => {
  const resultadoSemDsn = await relatarErroSentry("Falha textual", {
    dsn: undefined,
    servico: "git-proxy",
  });
  assertEquals(resultadoSemDsn, false);

  const resultadoStatus500 = await relatarErroSentry("Falha textual sem stack", {
    dsn: "https://pubKey@o99.ingest.sentry.io/42",
    servico: "git-proxy",
    fetchFn: () => Promise.resolve(new Response("Erro", { status: 500 })),
  });
  assertEquals(resultadoStatus500, false);

  const resultadoExcecaoRede = await relatarErroSentry(new Error("Erro interno"), {
    dsn: "https://pubKey@o99.ingest.sentry.io/42",
    servico: "git-proxy",
    fetchFn: () => Promise.reject(new Error("Timeout de rede")),
  });
  assertEquals(resultadoExcecaoRede, false);
});
