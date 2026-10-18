// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { BancoD1Fake } from "./banco_d1_fake.ts";

Deno.test("banco_d1_fake: insere e consulta registros de catalogo_croquis e catalogo_aresta com JOIN em memoria", async () => {
  const banco = new BancoD1Fake();

  banco.inserirCroqui({
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    nome: " Serra do Cipó ",
    cidade: " Santana do Riacho ",
    estado: " MG ",
    atualizado_em: 1700000000,
  });

  banco.inserirEntidade({
    uid: "SETOR123456789",
    tipo: "setor",
    croqui_uid: "CROQUI12345678",
    nome: " Vale da Lua ",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  banco.inserirEntidade({
    uid: "ESCALA12345678",
    tipo: "escalada",
    croqui_uid: "CROQUI12345678",
    nome: " Rapa Nui ",
    escalada_grau: " 7b ",
    escalada_tipo: " esportiva ",
    setor_uid: "SETOR123456789",
    grupo_uid: null,
  });

  const croquis = await banco
    .prepare("SELECT croqui_uid, id_slug, nome, cidade, estado FROM catalogo_croquis WHERE croqui_uid = ?")
    .bind("CROQUI12345678")
    .all<{ croqui_uid: string; id_slug: string; nome: string; cidade: string; estado: string }>();

  assertEquals(croquis.results, [
    {
      croqui_uid: "CROQUI12345678",
      id_slug: "br_mg_serra_do_cipo",
      nome: "Serra do Cipó",
      cidade: "Santana do Riacho",
      estado: "MG",
    },
  ]);

  const entidades = await banco
    .prepare("SELECT uid, tipo, nome FROM catalogo_aresta WHERE uid = ?")
    .bind("ESCALA12345678")
    .all<{ uid: string; tipo: string; nome: string; setor_nome: string | null }>();

  assertEquals(entidades.results.length, 1);
  assertEquals(entidades.results[0].uid, "ESCALA12345678");
  assertEquals(entidades.results[0].nome, "Rapa Nui");
  assertEquals(entidades.results[0].setor_nome, "Vale da Lua");
});

Deno.test("banco_d1_fake: retorna lista vazia para croquis, entidades inexistentes, orfas ou queries desconhecidas", async () => {
  const banco = new BancoD1Fake();

  banco.inserirCroqui({
    croqui_uid: "CROQUI_SEM_CID",
    id_slug: "br_rj_teste",
    nome: "Pico Isolado",
    cidade: null,
    estado: null,
  });

  banco.inserirEntidade({
    uid: "ENTIDADE_ORFA1",
    tipo: "escalada",
    croqui_uid: "CROQUI_INEXIST",
    nome: "Via Órfã",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  const croquiSemCidade = await banco
    .prepare("SELECT * FROM catalogo_croquis WHERE croqui_uid = ?")
    .bind("CROQUI_SEM_CID")
    .all<{ cidade: string | null; estado: string | null }>();
  assertEquals(croquiSemCidade.results[0].cidade, null);
  assertEquals(croquiSemCidade.results[0].estado, null);

  const croquiInexistente = await banco
    .prepare("SELECT * FROM catalogo_croquis WHERE croqui_uid = ?")
    .bind("NAO_EXISTE_123")
    .all();
  assertEquals(croquiInexistente.results, []);

  const entidadeInexistente = await banco
    .prepare("SELECT * FROM catalogo_aresta WHERE uid = ?")
    .bind("NAO_EXISTE_123")
    .all();
  assertEquals(entidadeInexistente.results, []);

  const entidadeOrfa = await banco
    .prepare("SELECT * FROM catalogo_aresta WHERE uid = ?")
    .bind("ENTIDADE_ORFA1")
    .all();
  assertEquals(entidadeOrfa.results, []);

  const queryDesconhecida = await banco
    .prepare("SELECT 1")
    .all();
  assertEquals(queryDesconhecida.results, []);
});

Deno.test("banco_d1_fake: simula falha deterministica de I/O quando configurada e restaura operacao ao limpar falha", async () => {
  const banco = new BancoD1Fake();
  banco.configurarFalha("Falha simulada no Cloudflare D1");

  await assertRejects(
    async () => {
      await banco.prepare("SELECT * FROM catalogo_croquis WHERE croqui_uid = ?").bind("X").all();
    },
    Error,
    "Falha simulada no Cloudflare D1"
  );

  banco.configurarFalha(null);
  const resultado = await banco
    .prepare("SELECT * FROM catalogo_croquis WHERE croqui_uid = ?")
    .bind("X")
    .all();

  assertEquals(resultado.results, []);
});
