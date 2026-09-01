// SPDX-License-Identifier: MPL-2.0
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

Deno.test("create-pr: rejeita requisicoes sem cabecalho Authorization com 401 e WWW-Authenticate", async () => {
  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    body: JSON.stringify({ branch: "edicao-1", title: "Titulo" }),
  });

  const resposta = await processarRequisicaoCreatePr(requisicao);
  assertEquals(resposta.status, 401);
  assertEquals(resposta.headers.get("WWW-Authenticate"), 'Bearer realm="create-pr"');
});

Deno.test("create-pr: rejeita requisicoes com JWT invalido com 401 e WWW-Authenticate", async () => {
  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: { "Authorization": "Bearer token-invalido" },
    body: JSON.stringify({ branch: "edicao-1", title: "Titulo" }),
  });

  const contextoMock = {
    validarJwt: async () => null,
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 401);
  assertEquals(resposta.headers.get("WWW-Authenticate"), 'Bearer realm="create-pr"');
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

Deno.test("create-pr: cria PR com sucesso para branch com prefixo edicao-", async () => {
  let prCriadoComSucesso: any = null;

  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: "edicao-lapinha-456",
      title: "Edição na Lapinha",
      description: "Novas vias adicionadas",
    }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-789",
      email: "colaborador@teste.com",
      nomeCompleto: "Colaborador",
    }),
    obterArquivosModificadosBranch: async () => [
      "database/lapinha/croqui.yaml",
    ],
    criarPullRequestGithub: async (dados: any) => {
      prCriadoComSucesso = dados;
      return {
        numeroPr: 88,
        urlPr: "https://github.com/aresta-climb/aresta_db/pull/88",
      };
    },
    atualizarMetadadosPr: async () => true,
    salvarMetadadosPr: async () => {},
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(prCriadoComSucesso.branch, "edicao-lapinha-456");
  assertEquals(prCriadoComSucesso.nomeAutor, "Colaborador");
  assertEquals(prCriadoComSucesso.emailAutor, "colaborador@teste.com");

  const corpo = await resposta.json();
  assertEquals(corpo.numero_pr, 88);
  assertEquals(corpo.url_pr, "https://github.com/aresta-climb/aresta_db/pull/88");
  assertEquals(corpo.pr_number, 88);
  assertEquals(corpo.pr_url, "https://github.com/aresta-climb/aresta_db/pull/88");
});

Deno.test("create-pr: retorna dados do PR existente sem criar duplicata se branch ja possui PR registrado", async () => {
  let funcaoCriarPrChamada = false;

  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: "edicao-existente-123",
      title: "Título",
    }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor",
    }),
    obterArquivosModificadosBranch: async () => ["database/croqui/croqui.yaml"],
    obterRegistroBranch: async () => ({
      id: "reg-1",
      branch_name: "edicao-existente-123",
      author_id: "user-123",
      author_email: "autor@teste.com",
      author_name: "Autor",
      pr_number: 105,
      pr_url: "https://github.com/aresta-climb/aresta_db/pull/105",
      status: "open",
    }),
    criarPullRequestGithub: async () => {
      funcaoCriarPrChamada = true;
      return { numeroPr: 999, urlPr: "fake" };
    },
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(funcaoCriarPrChamada, false);

  const corpo = await resposta.json();
  assertEquals(corpo.numero_pr, 105);
  assertEquals(corpo.url_pr, "https://github.com/aresta-climb/aresta_db/pull/105");
  assertEquals(corpo.pr_number, 105);
  assertEquals(corpo.pr_url, "https://github.com/aresta-climb/aresta_db/pull/105");
  assertEquals(corpo.atualizado, true);
});

Deno.test("create-pr: extrai token_usuario_github e repassa para funcao de criacao de PR", async () => {
  let tokenUsuarioRecebido: string | undefined;

  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: "edicao-teste-usuario-123",
      title: "Edição com Token",
      token_usuario_github: "gho_token_123",
    }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor",
    }),
    obterArquivosModificadosBranch: async () => ["database/croqui/croqui.yaml"],
    obterRegistroBranch: async () => null,
    criarPullRequestGithub: async (
      _dados: any,
      _octokit?: any,
      _dono?: string,
      _repo?: string,
      tokenUsuario?: string,
    ) => {
      tokenUsuarioRecebido = tokenUsuario;
      return { numeroPr: 106, urlPr: "https://github.com/aresta-climb/aresta_db/pull/106" };
    },
    salvarMetadadosPr: async () => {},
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(tokenUsuarioRecebido, "gho_token_123");
});

Deno.test("create-pr: aceita alias github_user_token e repassa para funcao de criacao de PR", async () => {
  let tokenUsuarioRecebido: string | undefined;

  const requisicao = new Request("http://localhost/create-pr", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token-valido",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: "edicao-teste-usuario-456",
      title: "Edição com Alias de Token",
      github_user_token: "gho_token_alias_456",
    }),
  });

  const contextoMock = {
    validarJwt: async () => ({
      idUsuario: "user-123",
      email: "autor@teste.com",
      nomeCompleto: "Autor",
    }),
    obterArquivosModificadosBranch: async () => ["database/croqui/croqui.yaml"],
    obterRegistroBranch: async () => null,
    criarPullRequestGithub: async (
      _dados: any,
      _octokit?: any,
      _dono?: string,
      _repo?: string,
      tokenUsuario?: string,
    ) => {
      tokenUsuarioRecebido = tokenUsuario;
      return { numeroPr: 107, urlPr: "https://github.com/aresta-climb/aresta_db/pull/107" };
    },
    salvarMetadadosPr: async () => {},
  };

  const resposta = await processarRequisicaoCreatePr(requisicao, contextoMock);
  assertEquals(resposta.status, 200);
  assertEquals(tokenUsuarioRecebido, "gho_token_alias_456");
});
