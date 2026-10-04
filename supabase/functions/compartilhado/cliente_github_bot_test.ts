// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "@std/assert";
import {
  obterTokenAutenticacaoGithub,
  obterTokenEditorAresta,
  obterTokenArestaClimbBot,
  obterInstanciaOctokit,
  verificarBranchExisteNoGithub,
  obterArquivosModificadosBranch,
  excluirBranchRemota,
  criarPullRequestGithub,
} from "./cliente_github_bot.ts";

Deno.test("cliente_github_bot: verificarBranchExisteNoGithub retorna true quando branch existe e false quando nao", async () => {
  const octokitMock: any = {
    rest: {
      repos: {
        getBranch: async ({ branch }: { branch: string }) => {
          if (branch === "sugestao-existente") {
            return { status: 200, data: { name: "sugestao-existente" } };
          }
          const erro: any = new Error("Not Found");
          erro.status = 404;
          throw erro;
        },
      },
    },
  };

  const existe = await verificarBranchExisteNoGithub("sugestao-existente", octokitMock);
  assertEquals(existe, true);

  const naoExiste = await verificarBranchExisteNoGithub("sugestao-inexistente", octokitMock);
  assertEquals(naoExiste, false);

  const octokitComErro: any = {
    rest: {
      repos: {
        getBranch: async () => {
          throw new Error("GitHub API Network Failure / 500");
        },
      },
    },
  };
  const resultadoErro = await verificarBranchExisteNoGithub("qualquer-branch", octokitComErro);
  assertEquals(resultadoErro, false);
});

Deno.test("cliente_github_bot: obterArquivosModificadosBranch retorna a lista de caminhos de arquivos", async () => {
  const octokitMock: any = {
    rest: {
      repos: {
        compareCommits: async () => ({
          status: 200,
          data: {
            files: [
              { filename: "database/lapinha/croqui.yaml" },
              { filename: "database/lapinha/foto.webp" },
            ],
          },
        }),
      },
    },
  };

  const arquivos = await obterArquivosModificadosBranch("sugestao-123", "main", octokitMock);
  assertEquals(arquivos, [
    "database/lapinha/croqui.yaml",
    "database/lapinha/foto.webp",
  ]);
});

Deno.test("cliente_github_bot: excluirBranchRemota deleta ref no github", async () => {
  let refExcluida = "";
  const octokitMock: any = {
    rest: {
      git: {
        deleteRef: async ({ ref }: { ref: string }) => {
          refExcluida = ref;
          return { status: 204 };
        },
      },
    },
  };

  const sucesso = await excluirBranchRemota("sugestao-maliciosa", octokitMock);
  assertEquals(sucesso, true);
  assertEquals(refExcluida, "heads/sugestao-maliciosa");
});

Deno.test("cliente_github_bot: criarPullRequestGithub cria PR com template formatado e assinatura", async () => {
  let payloadPr: any = null;
  const octokitMock: any = {
    rest: {
      pulls: {
        create: async (payload: any) => {
          payloadPr = payload;
          return {
            status: 201,
            data: {
              number: 42,
              html_url: "https://github.com/aresta-climb/aresta_db/pull/42",
            },
          };
        },
      },
    },
  };

  const resultado = await criarPullRequestGithub(
    {
      branch: "sugestao-lapinha-123",
      titulo: "Sugestão: Lapinha",
      descricao: "Nova via aberta",
      nomeAutor: "Renato Utsch",
      emailAutor: "renatoutsch@gmail.com",
    },
    octokitMock,
  );

  assertEquals(resultado.numeroPr, 42);
  assertEquals(resultado.urlPr, "https://github.com/aresta-climb/aresta_db/pull/42");
  assertEquals(payloadPr.title, "Sugestão: Lapinha");
  assertEquals(payloadPr.head, "sugestao-lapinha-123");
  assertEquals(payloadPr.base, "main");
  assertEquals(payloadPr.body.includes("Renato Utsch"), true);
  assertEquals(payloadPr.body.includes("renatoutsch@gmail.com"), true);
  assertEquals(payloadPr.body.includes("Signed-off-by: Renato Utsch <renatoutsch@gmail.com>"), true);
});

Deno.test("cliente_github_bot: criarPullRequestGithub faz fallback para PR existente se create falhar", async () => {
  const octokitMock: any = {
    rest: {
      pulls: {
        create: async () => {
          const erro: any = new Error("A pull request already exists for aresta-climb:sugestao-lapinha-123");
          erro.status = 422;
          throw erro;
        },
        list: async ({ head }: { head: string }) => {
          if (head === "aresta-climb:sugestao-lapinha-123") {
            return {
              data: [
                {
                  number: 99,
                  html_url: "https://github.com/aresta-climb/aresta_db/pull/99",
                },
              ],
            };
          }
          return { data: [] };
        },
      },
    },
  };

  const resultado = await criarPullRequestGithub(
    {
      branch: "sugestao-lapinha-123",
      titulo: "Sugestão: Lapinha",
      descricao: "Nova via",
      nomeAutor: "Renato",
      emailAutor: "renato@teste.com",
    },
    octokitMock,
  );

  assertEquals(resultado.numeroPr, 99);
  assertEquals(resultado.urlPr, "https://github.com/aresta-climb/aresta_db/pull/99");
});

Deno.test("cliente_github_bot: criarPullRequestGithub utiliza Octokit com tokenUsuarioGithub quando informado", async () => {
  let octokitUtilizado: any = null;
  const fabriqueOctokitMock = (token: string) => {
    return {
      rest: {
        pulls: {
          create: async (payload: any) => {
            octokitUtilizado = token;
            return {
              status: 201,
              data: {
                number: 101,
                html_url: "https://github.com/aresta-climb/aresta_db/pull/101",
              },
            };
          },
        },
      },
    };
  };

  const resultado = await criarPullRequestGithub(
    {
      branch: "edicao-teste-123",
      titulo: "Edição do Usuário",
      descricao: "Detalhes",
      nomeAutor: "Escalador",
      emailAutor: "escalador@teste.com",
    },
    undefined,
    undefined,
    undefined,
    "gho_token_usuario_oauth_abc",
    fabriqueOctokitMock as any,
  );

  assertEquals(resultado.numeroPr, 101);
  assertEquals(resultado.urlPr, "https://github.com/aresta-climb/aresta_db/pull/101");
  assertEquals(octokitUtilizado, "gho_token_usuario_oauth_abc");
});

Deno.test("cliente_github_bot: criarPullRequestGithub faz fallback para bot se tokenUsuarioGithub falhar", async () => {
  let fallbackChamado = false;
  const fabriqueOctokitMock = (token?: string) => {
    if (token === "gho_token_invalido") {
      return {
        rest: {
          pulls: {
            create: async () => {
              const erro: any = new Error("Bad credentials");
              erro.status = 401;
              throw erro;
            },
          },
        },
      };
    }
    // Bot fallback
    return {
      rest: {
        pulls: {
          create: async () => {
            fallbackChamado = true;
            return {
              status: 201,
              data: {
                number: 102,
                html_url: "https://github.com/aresta-climb/aresta_db/pull/102",
              },
            };
          },
        },
      },
    };
  };

  const resultado = await criarPullRequestGithub(
    {
      branch: "edicao-teste-123",
      titulo: "Edição com Fallback",
      descricao: "Detalhes",
      nomeAutor: "Escalador",
      emailAutor: "escalador@teste.com",
    },
    undefined,
    undefined,
    undefined,
    "gho_token_invalido",
    fabriqueOctokitMock as any,
  );

  assertEquals(resultado.numeroPr, 102);
  assertEquals(resultado.urlPr, "https://github.com/aresta-climb/aresta_db/pull/102");
  assertEquals(fallbackChamado, true);
});


Deno.test("cliente_github_bot: obterInstanciaOctokit instancia cliente com token do ambiente", async () => {
  Deno.env.set("GITHUB_BOT_TOKEN", "token-bot-teste");
  const octokit = await obterInstanciaOctokit();
  assertEquals(typeof octokit.rest.repos.getBranch, "function");
  Deno.env.delete("GITHUB_BOT_TOKEN");
});

Deno.test("cliente_github_bot: obterTokenAutenticacaoGithub retorna GITHUB_BOT_TOKEN quando configurado", async () => {
  Deno.env.set("GITHUB_BOT_TOKEN", "token-pat-teste");
  const token = await obterTokenAutenticacaoGithub();
  assertEquals(token, "token-pat-teste");
  Deno.env.delete("GITHUB_BOT_TOKEN");
});

Deno.test("cliente_github_bot: obterTokenEditorAresta retorna string vazia quando sem variaveis", async () => {
  Deno.env.delete("GITHUB_BOT_TOKEN");
  Deno.env.delete("EDITOR_ARESTA_GITHUB_APP_CLIENT_ID");
  Deno.env.delete("EDITOR_ARESTA_GITHUB_APP_PRIVATE_KEY");
  Deno.env.delete("EDITOR_ARESTA_GITHUB_APP_INSTALLATION_ID");
  const token = await obterTokenEditorAresta();
  assertEquals(token, "");
});

Deno.test("cliente_github_bot: obterTokenEditorAresta captura erro gracefully com chave invalida", async () => {
  Deno.env.delete("GITHUB_BOT_TOKEN");
  Deno.env.set("EDITOR_ARESTA_GITHUB_APP_CLIENT_ID", "Iv23fake");
  Deno.env.set("EDITOR_ARESTA_GITHUB_APP_PRIVATE_KEY", "chave_invalida");
  Deno.env.set("EDITOR_ARESTA_GITHUB_APP_INSTALLATION_ID", "12345");

  const token = await obterTokenEditorAresta();
  assertEquals(token, "");

  Deno.env.delete("EDITOR_ARESTA_GITHUB_APP_CLIENT_ID");
  Deno.env.delete("EDITOR_ARESTA_GITHUB_APP_PRIVATE_KEY");
  Deno.env.delete("EDITOR_ARESTA_GITHUB_APP_INSTALLATION_ID");
});

Deno.test("cliente_github_bot: obterTokenArestaClimbBot opera exclusivamente com ARESTA_CLIMB_BOT_GITHUB_APP_*", async () => {
  Deno.env.set("ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID", "Iv23clienteAresta");
  Deno.env.set("ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY", "chave_rsa_teste");
  Deno.env.set("ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID", "88888");

  const token = await obterTokenArestaClimbBot();
  assertEquals(token, ""); // falha de parseamento de chave RSA de teste é capturada graciosamente

  Deno.env.delete("ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID");
  Deno.env.delete("ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY");
  Deno.env.delete("ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID");
});
