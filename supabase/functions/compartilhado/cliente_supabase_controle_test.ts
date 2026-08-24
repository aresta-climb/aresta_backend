// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { assertEquals, assertThrows } from "@std/assert";
import {
  extrairChaveSecretaSupabase,
  obterClienteSupabaseAdmin,
  validarTokenJwt,
  obterRegistroBranch,
  registrarNovaBranch,
  atualizarMetadadosPr,
} from "./cliente_supabase_controle.ts";

Deno.test("cliente_supabase_controle: validarTokenJwt extrai id, email e nome dos metadados", async () => {
  const clienteMock: any = {
    auth: {
      getUser: async (token: string) => {
        if (token === "token-valido") {
          return {
            data: {
              user: {
                id: "user-123",
                email: "escalador@teste.com",
                user_metadata: {
                  nome_completo: "Renato Utsch",
                },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: "Invalid token" } };
      },
    },
  };

  const resultadoValido = await validarTokenJwt("token-valido", clienteMock);
  assertEquals(resultadoValido?.idUsuario, "user-123");
  assertEquals(resultadoValido?.email, "escalador@teste.com");
  assertEquals(resultadoValido?.nomeCompleto, "Renato Utsch");

  const resultadoInvalido = await validarTokenJwt("token-invalido", clienteMock);
  assertEquals(resultadoInvalido, null);
});

Deno.test("cliente_supabase_controle: validarTokenJwt usa fallback de nome quando nome_completo esta ausente", async () => {
  const clienteMock: any = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "user-456",
            email: "escalador_sem_nome@teste.com",
            user_metadata: {},
          },
        },
        error: null,
      }),
    },
  };

  const resultado = await validarTokenJwt("token-sem-nome", clienteMock);
  assertEquals(resultado?.nomeCompleto, "escalador_sem_nome");
});

Deno.test("cliente_supabase_controle: obterRegistroBranch consulta registro na tabela", async () => {
  const clienteMock: any = {
    from: (_tabela: string) => ({
      select: (_campos: string) => ({
        eq: (_campo: string, valor: string) => ({
          maybeSingle: async () => {
            if (valor === "sugestao-existente") {
              return {
                data: {
                  id: "uuid-1",
                  branch_name: "sugestao-existente",
                  author_id: "user-123",
                  author_email: "autor@teste.com",
                  author_name: "Autor Teste",
                  pr_number: 10,
                  pr_url: "https://github.com/aresta-climb/aresta_db/pull/10",
                  status: "aberta",
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };

  const existente = await obterRegistroBranch("sugestao-existente", clienteMock);
  assertEquals(existente?.branch_name, "sugestao-existente");
  assertEquals(existente?.author_email, "autor@teste.com");

  const inexistente = await obterRegistroBranch("sugestao-inexistente", clienteMock);
  assertEquals(inexistente, null);
});

Deno.test("cliente_supabase_controle: registrarNovaBranch e atualizarMetadadosPr realizam operacoes no banco", async () => {
  let inserido: any = null;
  let atualizado: any = null;

  const clienteMock: any = {
    from: (_tabela: string) => ({
      insert: (dados: any) => {
        inserido = dados;
        return {
          select: () => ({
            single: async () => ({ data: { id: "novo-id", ...dados }, error: null }),
          }),
        };
      },
      update: (dados: any) => ({
        eq: (_campo: string, _valor: string) => {
          atualizado = dados;
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  await registrarNovaBranch(
    {
      branchName: "sugestao-nova",
      authorId: "user-123",
      authorEmail: "autor@teste.com",
      authorName: "Autor Teste",
    },
    clienteMock,
  );

  assertEquals(inserido.branch_name, "sugestao-nova");
  assertEquals(inserido.author_email, "autor@teste.com");

  await atualizarMetadadosPr(
    "sugestao-nova",
    {
      prNumber: 99,
      prUrl: "https://github.com/aresta-climb/aresta_db/pull/99",
    },
    clienteMock,
  );

  assertEquals(atualizado.pr_number, 99);
  assertEquals(atualizado.pr_url, "https://github.com/aresta-climb/aresta_db/pull/99");
});


Deno.test("cliente_supabase_controle: obterClienteSupabaseAdmin inicializa cliente com SUPABASE_SECRET_KEYS no formato JSON", () => {
  Deno.env.set("SUPABASE_URL", "http://localhost:54321");
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_chave_json" }));
  const cliente = obterClienteSupabaseAdmin();
  assertEquals(typeof cliente.from, "function");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
});

Deno.test("cliente_supabase_controle: obterClienteSupabaseAdmin aceita SUPABASE_SECRET_KEYS como string direta", () => {
  Deno.env.set("SUPABASE_URL", "http://localhost:54321");
  Deno.env.set("SUPABASE_SECRET_KEYS", "sb_secret_chave_direta");
  const cliente = obterClienteSupabaseAdmin();
  assertEquals(typeof cliente.from, "function");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
});

Deno.test("cliente_supabase_controle: extrairChaveSecretaSupabase retorna string vazia quando SUPABASE_SECRET_KEYS ausente", () => {
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  assertEquals(extrairChaveSecretaSupabase(), "");
});

Deno.test("cliente_supabase_controle: obterClienteSupabaseAdmin lanca erro quando SUPABASE_SECRET_KEYS ausente", () => {
  Deno.env.set("SUPABASE_URL", "http://localhost:54321");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  assertThrows(() => obterClienteSupabaseAdmin(), Error, "supabaseKey is required");
});
