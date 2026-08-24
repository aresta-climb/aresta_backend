// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { assertEquals, assertStringIncludes } from "@std/assert";
import { processarRequisicaoCreatePr } from "./index.ts";

Deno.test("create-pr: responde a requisicoes OPTIONS com cabecalhos CORS", async () => {
  const requisicao = new Request("http://localhost/create-pr", {
    method: "OPTIONS",
  });

  const resposta = await processarRequisicaoCreatePr(requisicao);
  assertEquals(resposta.status, 204);
  assertEquals(resposta.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("create-pr: rejeita requisicoes sem cabecalho Authorization com 401", async () => {
  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    body: JSON.stringify({ branch: "sugestao-1", title: "Titulo" }),
  });

  const resposta = await processarRequisicaoCreatePr(requisicao);
  assertEquals(resposta.status, 401);
});

Deno.test("create-pr: rejeita requisicoes com JWT invalido com 401", async () => {
  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: { "Authorization": "Bearer token-invalido" },
    body: JSON.stringify({ branch: "sugestao-1", title: "Titulo" }),
  });

  const contextoMock = {
    validarJwt: async () => null,
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 401);
});

Deno.test("create-pr: rejeita corpo JSON mal formatado ou faltando campos com 400", async () => {
  const requisicaoSemBranch = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "Sem branch" }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
  };

  const resposta1 = await processarRequisicaoCreatePr(requisicaoSemBranch, contextoMock);
  assertEquals(resposta1.status, 400);

  const requisicaoJsonInvalido = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: "corpo-invalido-nao-json",
  });

  const resposta2 = await processarRequisicaoCreatePr(requisicaoJsonInvalido, contextoMock);
  assertEquals(resposta2.status, 400);
});

Deno.test("create-pr: rejeita branch com nome invalido com 400", async () => {
  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ branch: "branch-fora-do-padrao", title: "Titulo" }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 400);
});

Deno.test("create-pr: rejeita branch com arquivos fora de database/ e exclui branch (400)", async () => {
  let branchExcluida = "";

  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: "sugestao-maliciosa",
      title: "Titulo",
      description: "Descricao",
    }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
    obterArquivosModificadosBranch: async () => [
      "database/lapinha/croqui.yaml",
      "src/executavel.ts",
    ],
    excluirBranchRemota: async (branch: string) => {
      branchExcluida = branch;
      return true;
    },
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 400);
  assertEquals(branchExcluida, "sugestao-maliciosa");
  const corpo = await resposta.json();
  assertStringIncludes(corpo.erro, "database");
  assertEquals(corpo.arquivos_invalidos, ["src/executavel.ts"]);
});

Deno.test("create-pr: cria PR com sucesso quando arquivos estao em database/", async () => {
  let prCriadoComSucesso: any = null;
  let metadadosSalvos = false;

  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: "sugestao-lapinha-123",
      title: "Sugestão: Lapinha",
      description: "Nova via",
    }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
    obterArquivosModificadosBranch: async () => [
      "database/lapinha/croqui.yaml",
    ],
    criarPullRequestGithub: async (dados: any) => {
      prCriadoComSucesso = dados;
      return { numeroPr: 77, urlPr: "https://github.com/aresta-climb/aresta_db/pull/77" };
    },
    atualizarMetadadosPr: async () => {
      metadadosSalvos = true;
      return true;
    },
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(metadadosSalvos, true);
  assertEquals(prCriadoComSucesso.branch, "sugestao-lapinha-123");
  assertEquals(prCriadoComSucesso.nomeAutor, "Autor Teste");
  assertEquals(prCriadoComSucesso.emailAutor, "autor@teste.com");

  const corpo = await resposta.json();
  assertEquals(corpo.numero_pr, 77);
  assertEquals(corpo.url_pr, "https://github.com/aresta-climb/aresta_db/pull/77");
});

Deno.test("create-pr: rejeita metodos HTTP diferentes de POST e OPTIONS com 405", async () => {
  const requisicao = new Request("http://localhost/create-pr", {
    method: "GET",
    headers: { "Authorization": "Bearer token-valido" },
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor Teste",
    }),
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 405);
});
