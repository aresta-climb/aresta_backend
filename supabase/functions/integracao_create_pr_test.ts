// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { assertEquals, assertStringIncludes } from "@std/assert";
import { processarRequisicaoCreatePr } from "./create-pr/index.ts";

Deno.test({
  name: "Integracao Create PR: Rejeita requisicao sem autorizacao com 401",
  async fn() {
    const requisicao = new Request("http://localhost/create-pr", {
      method: "POST",
      body: JSON.stringify({ branch: "sugestao-teste", title: "Teste" }),
    });

    const resposta = await processarRequisicaoCreatePr(requisicao);
    assertEquals(resposta.status, 401);
  },
});

Deno.test({
  name: "Integracao Create PR: Rejeita alteracoes fora da pasta database e deleta branch (400)",
  async fn() {
    let branchExcluida = false;

    const requisicao = new Request("http://localhost/create-pr", {
      method: "POST",
      headers: {
        "Authorization": "Bearer token-jwt-valido-teste",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch: "sugestao-maliciosa",
        title: "Tentativa de alteracao indevida",
        description: "Descricao",
      }),
    });

    const contextoTeste = {
      validarJwt: async (_token: string) => ({
        idUsuario: "user-123",
        email: "escalador@teste.com",
        nomeCompleto: "Escalador Teste",
      }),
      obterArquivosModificadosBranch: async (_branch: string) => [
        "database/lapinha/croqui.yaml",
        ".github/workflows/deploy.yml", // Arquivo fora de database/
      ],
      excluirBranchRemota: async (branch: string) => {
        if (branch === "sugestao-maliciosa") {
          branchExcluida = true;
        }
        return true;
      },
    };

    const resposta = await processarRequisicaoCreatePr(requisicao, contextoTeste);
    assertEquals(resposta.status, 400);
    assertEquals(branchExcluida, true);
    const corpo = await resposta.json();
    assertStringIncludes(corpo.erro, "database");
  },
});

Deno.test({
  name: "Integracao Create PR: Cria Pull Request com sucesso quando alteracoes sao restritas a database/",
  async fn() {
    const requisicao = new Request("http://localhost/create-pr", {
      method: "POST",
      headers: {
        "Authorization": "Bearer token-jwt-valido-teste",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch: "sugestao-lapinha-123",
        title: "Sugestão: Lapinha Atualizada",
        description: "Adicionadas 2 novas vias.",
      }),
    });

    const contextoTeste = {
      validarJwt: async (_token: string) => ({
        idUsuario: "user-123",
        email: "escalador@teste.com",
        nomeCompleto: "Escalador Teste",
      }),
      obterArquivosModificadosBranch: async (_branch: string) => [
        "database/lapinha/croqui.yaml",
        "database/lapinha/mapas/mapa1.webp",
      ],
      criarPullRequestGithub: async (dados: {
        branch: string;
        titulo: string;
        descricao: string;
        nomeAutor: string;
        emailAutor: string;
      }) => {
        assertEquals(dados.branch, "sugestao-lapinha-123");
        assertEquals(dados.nomeAutor, "Escalador Teste");
        assertEquals(dados.emailAutor, "escalador@teste.com");
        return {
          numeroPr: 42,
          urlPr: "https://github.com/aresta-climb/aresta_db/pull/42",
        };
      },
      salvarMetadadosPr: async (_branch: string, _numeroPr: number, _urlPr: string) => {},
    };

    const resposta = await processarRequisicaoCreatePr(requisicao, contextoTeste);
    assertEquals(resposta.status, 200);
    const corpo = await resposta.json();
    assertEquals(corpo.numero_pr, 42);
    assertEquals(corpo.url_pr, "https://github.com/aresta-climb/aresta_db/pull/42");
  },
});

Deno.test({
  name: "Integracao Create PR: Cria Pull Request repassando token de usuario quando presente",
  async fn() {
    let tokenUsuarioRecebido: string | undefined;

    const requisicao = new Request("http://localhost/create-pr", {
      method: "POST",
      headers: {
        "Authorization": "Bearer token-jwt-valido-teste",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch: "edicao-lapinha-123",
        title: "Edição com Token do Usuário",
        description: "Enviado diretamente",
        token_usuario_github: "gho_token_usuario_123",
      }),
    });

    const contextoTeste = {
      validarJwt: async (_token: string) => ({
        idUsuario: "user-123",
        email: "escalador@teste.com",
        nomeCompleto: "Escalador Teste",
      }),
      obterArquivosModificadosBranch: async (_branch: string) => [
        "database/lapinha/croqui.yaml",
      ],
      criarPullRequestGithub: async (
        dados: any,
        _octokit?: any,
        _dono?: string,
        _repo?: string,
        tokenUsuario?: string,
      ) => {
        tokenUsuarioRecebido = tokenUsuario;
        return {
          numeroPr: 50,
          urlPr: "https://github.com/aresta-climb/aresta_db/pull/50",
        };
      },
      salvarMetadadosPr: async (_branch: string, _numeroPr: number, _urlPr: string) => {},
    };

    const resposta = await processarRequisicaoCreatePr(requisicao, contextoTeste);
    assertEquals(resposta.status, 200);
    assertEquals(tokenUsuarioRecebido, "gho_token_usuario_123");
  },
});
