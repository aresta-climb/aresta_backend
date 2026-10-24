// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals, assertStringIncludes } from "@std/assert";
import { processarRequisicaoGitProxy } from "./index.ts";

function criarPayloadPktLine(comando: string): Uint8Array {
  const tamanhoHex = (comando.length + 4).toString(16).padStart(4, "0");
  return new TextEncoder().encode(`${tamanhoHex}${comando}0000`);
}

Deno.test("git-proxy: responde a requisicoes OPTIONS com cabecalhos CORS", async () => {
  const requisicao = new Request("http://localhost/git-proxy", {
    method: "OPTIONS",
  });

  const resposta = await processarRequisicaoGitProxy(requisicao);
  assertEquals(resposta.status, 204);
  assertEquals(resposta.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("git-proxy: rejeita requisicoes sem cabecalho Authorization com 401 e WWW-Authenticate", async () => {
  const requisicao = new Request("http://localhost/git-proxy/info/refs?service=git-receive-pack", {
    method: "GET",
  });

  const resposta = await processarRequisicaoGitProxy(requisicao);
  assertEquals(resposta.status, 401);
  assertEquals(resposta.headers.get("WWW-Authenticate"), 'Basic realm="git-proxy"');
});

Deno.test("git-proxy: rejeita requisicoes com JWT invalido com 401 e WWW-Authenticate", async () => {
  const requisicao = new Request("http://localhost/git-proxy/info/refs?service=git-receive-pack", {
    method: "GET",
    headers: { "Authorization": "Bearer token-invalido" },
  });

  const contextoMock = {
    validarJwt: async () => null,
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 401);
  assertEquals(resposta.headers.get("WWW-Authenticate"), 'Basic realm="git-proxy"');
});

Deno.test("git-proxy: GET /info/refs encaminha para o GitHub e injeta credenciais", async () => {
  let urlEncaminhada = "";
  let authEncaminhada = "";

  const requisicao = new Request("http://localhost/git-proxy/info/refs?service=git-receive-pack", {
    method: "GET",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
    },
  });

  const contextoMock = {
    validarJwt: async (_token: string) => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
    executarFetchGithub: async (url: string, init?: RequestInit) => {
      urlEncaminhada = url;
      authEncaminhada = (init?.headers as Record<string, string>)?.["Authorization"] || "";
      return new Response("001e# service=git-receive-pack\n0000", {
        status: 200,
        headers: { "Content-Type": "application/x-git-receive-pack-advertisement" },
      });
    },
    tokenBot: "bot-token-secreto",
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertStringIncludes(urlEncaminhada, "/info/refs?service=git-receive-pack");
  assertStringIncludes(authEncaminhada, "Basic ");
});

Deno.test("git-proxy: POST /git-receive-pack rejeita payload sem comandos validos", async () => {
  const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
    },
    body: new Uint8Array([0x30, 0x30, 0x30, 0x30]) as unknown as BodyInit,
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 400);
});

Deno.test("git-proxy: POST /git-receive-pack rejeita branch invalida com 403", async () => {
  const linhaComando = "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/main\0report-status\n";
  const payload = criarPayloadPktLine(linhaComando);

  const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
      "Content-Type": "application/x-git-receive-pack-request",
    },
    body: payload as unknown as BodyInit,
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 403);
});

Deno.test("git-proxy: POST /git-receive-pack rejeita criacao de branch existente com 409", async () => {
  const linhaComando = "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-ja-existe\0report-status\n";
  const payload = criarPayloadPktLine(linhaComando);

  const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
      "Content-Type": "application/x-git-receive-pack-request",
    },
    body: payload as unknown as BodyInit,
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
    verificarBranchExisteNoGithub: async () => true,
    obterRegistroBranch: async () => null,
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 409);
});

Deno.test("git-proxy: POST /git-receive-pack rejeita atualizacao por outro autor com 403", async () => {
  const linhaComando = "7c2d1e0000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-outro-autor\0report-status\n";
  const payload = criarPayloadPktLine(linhaComando);

  const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
      "Content-Type": "application/x-git-receive-pack-request",
    },
    body: payload as unknown as BodyInit,
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "invasor@teste.com",
      nomeCompleto: "Invasor Teste",
    }),
    obterRegistroBranch: async () => ({
      id: "1",
      branch_name: "sugestao-outro-autor",
      author_id: "user-999",
      author_email: "autor_original@teste.com",
      author_name: "Autor Original",
      pr_number: null,
      pr_url: null,
      status: "aberta",
    }),
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 403);
});

Deno.test("git-proxy: POST /git-receive-pack cria nova branch com sucesso e encaminha stream", async () => {
  let branchRegistrada: any = null;
  let streamEncaminhado = false;

  const linhaComando = "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-nova\0report-status\n";
  const payload = criarPayloadPktLine(linhaComando);

  const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
      "Content-Type": "application/x-git-receive-pack-request",
    },
    body: payload as unknown as BodyInit,
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
    verificarBranchExisteNoGithub: async () => false,
    obterRegistroBranch: async () => null,
    registrarNovaBranch: async (dados: any) => {
      branchRegistrada = dados;
      return { id: "1", ...dados, status: "aberta" };
    },
    executarFetchGithub: async () => {
      streamEncaminhado = true;
      return new Response("0008NAK\n", { status: 200 });
    },
    tokenBot: "bot-token-secreto",
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(streamEncaminhado, true);
  assertEquals(branchRegistrada?.branchName, "sugestao-lapinha-nova");
  assertEquals(branchRegistrada?.authorEmail, "autor@teste.com");
  assertEquals(branchRegistrada?.authorName, "Autor Teste");
});

Deno.test("git-proxy: POST /git-receive-pack atualiza branch existente do mesmo autor com sucesso", async () => {
  let streamEncaminhado = false;

  const linhaComando = "7c2d1e0000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-existente\0report-status\n";
  const payload = criarPayloadPktLine(linhaComando);

  const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
      "Content-Type": "application/x-git-receive-pack-request",
    },
    body: payload as unknown as BodyInit,
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
    obterRegistroBranch: async () => ({
      id: "1",
      branch_name: "sugestao-lapinha-existente",
      author_id: "user-123",
      author_email: "autor@teste.com",
      author_name: "Autor Teste",
      pr_number: null,
      pr_url: null,
      status: "aberta",
    }),
    executarFetchGithub: async () => {
      streamEncaminhado = true;
      return new Response("0008NAK\n", { status: 200 });
    },
    tokenBot: "bot-token-secreto",
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(streamEncaminhado, true);
});

Deno.test("git-proxy: rejeita metodos HTTP nao suportados com 405", async () => {
  const requisicao = new Request("http://localhost/git-proxy", {
    method: "PUT",
    headers: { "Authorization": "Bearer token-jwt-valido" },
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 405);
});

Deno.test("git-proxy: POST /git-receive-pack cria nova branch com prefixo edicao- e registra corretamente", async () => {
  let branchRegistrada: any = null;
  let streamEncaminhado = false;

  const linhaComando = "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/edicao-lapinha-nova\0report-status\n";
  const payload = criarPayloadPktLine(linhaComando);

  const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-jwt-valido",
      "Content-Type": "application/x-git-receive-pack-request",
    },
    body: payload as unknown as BodyInit,
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-456",
      email: "colaborador@teste.com",
      nomeCompleto: "Colaborador",
    }),
    verificarBranchExisteNoGithub: async () => false,
    obterRegistroBranch: async () => null,
    registrarNovaBranch: async (dados: any) => {
      branchRegistrada = dados;
      return { id: "2", ...dados, status: "aberta" };
    },
    executarFetchGithub: async () => {
      streamEncaminhado = true;
      return new Response("0008NAK\n", { status: 200 });
    },
    tokenBot: "bot-token-secreto",
  };

  const resposta = await processarRequisicaoGitProxy(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(streamEncaminhado, true);
  assertEquals(branchRegistrada?.branchName, "edicao-lapinha-nova");
  assertEquals(branchRegistrada?.authorEmail, "colaborador@teste.com");
  assertEquals(branchRegistrada?.authorName, "Colaborador");
});

Deno.test("git-proxy: captura excecao inesperada, retorna 500 e reporta ao Sentry via RelatorSentryFake", async () => {
  const { RelatorSentryFake } = await import("../compartilhado/relator_sentry_fake.ts");
  const relatorFake = new RelatorSentryFake();

  const requisicao = new Request("http://localhost/git-proxy/info/refs?service=git-receive-pack", {
    method: "GET",
    headers: { "Authorization": "Bearer token-jwt-valido" },
  });

  const resposta = await processarRequisicaoGitProxy(requisicao, {
    validarJwt: () => Promise.reject(new Error("Falha inesperada ao validar JWT")),
    sentryDsn: "https://pub@o1.ingest.sentry.io/1",
    relatorSentry: relatorFake,
  });

  assertEquals(resposta.status, 500);
  assertEquals(relatorFake.eventos.length, 1);
  assertEquals(relatorFake.eventos[0].servico, "supabase-git-proxy");
  assertEquals(relatorFake.eventos[0].mensagem, "Falha inesperada ao validar JWT");
});
