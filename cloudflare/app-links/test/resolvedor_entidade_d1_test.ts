// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { resolverEntidadePorUid } from "../src/resolvedor_entidade_d1.ts";
import { BancoD1Fake } from "./banco_d1_fake.ts";

function criarBancoPopulado(): BancoD1Fake {
  const banco = new BancoD1Fake();

  banco.inserirCroqui({
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    nome: "Serra do Cipó",
    cidade: "Santana do Riacho",
    estado: "MG",
  });

  banco.inserirEntidade({
    uid: "GRUPO123456789",
    tipo: "grupo",
    croqui_uid: "CROQUI12345678",
    nome: "Grupo Principal",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  banco.inserirEntidade({
    uid: "SETOR123456789",
    tipo: "setor",
    croqui_uid: "CROQUI12345678",
    nome: "Setor Vale da Lua",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: "GRUPO123456789",
  });

  banco.inserirEntidade({
    uid: "ESCALA12345678",
    tipo: "escalada",
    croqui_uid: "CROQUI12345678",
    nome: "Rapa Nui",
    escalada_grau: "7b",
    escalada_tipo: "esportiva",
    setor_uid: "SETOR123456789",
    grupo_uid: "GRUPO123456789",
  });

  return banco;
}

Deno.test("resolvedor_entidade_d1: resolve UID de um croqui diretamente em catalogo_croquis", async () => {
  const banco = criarBancoPopulado();

  const resumo = await resolverEntidadePorUid(banco, "CROQUI12345678");

  assertEquals(resumo, {
    uid: "CROQUI12345678",
    tipo: "croqui",
    nome: "Serra do Cipó",
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    croqui_nome: "Serra do Cipó",
    cidade: "Santana do Riacho",
    estado: "MG",
    escalada_grau: null,
    escalada_tipo: null,
    setor_nome: null,
    grupo_nome: null,
  });
});

Deno.test("resolvedor_entidade_d1: resolve UID de uma escalada com JOIN de croqui, setor pai e grupo pai", async () => {
  const banco = criarBancoPopulado();

  const resumo = await resolverEntidadePorUid(banco, "ESCALA12345678");

  assertEquals(resumo, {
    uid: "ESCALA12345678",
    tipo: "escalada",
    nome: "Rapa Nui",
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    croqui_nome: "Serra do Cipó",
    cidade: "Santana do Riacho",
    estado: "MG",
    escalada_grau: "7b",
    escalada_tipo: "esportiva",
    setor_nome: "Setor Vale da Lua",
    grupo_nome: "Grupo Principal",
  });
});

Deno.test("resolvedor_entidade_d1: resolve UID de setor e grupo preservando hierarquia disponivel", async () => {
  const banco = criarBancoPopulado();

  const resumoSetor = await resolverEntidadePorUid(banco, "SETOR123456789");
  assertEquals(resumoSetor?.tipo, "setor");
  assertEquals(resumoSetor?.nome, "Setor Vale da Lua");
  assertEquals(resumoSetor?.grupo_nome, "Grupo Principal");
  assertEquals(resumoSetor?.setor_nome, null);

  const resumoGrupo = await resolverEntidadePorUid(banco, "GRUPO123456789");
  assertEquals(resumoGrupo?.tipo, "grupo");
  assertEquals(resumoGrupo?.nome, "Grupo Principal");
  assertEquals(resumoGrupo?.grupo_nome, null);
  assertEquals(resumoGrupo?.setor_nome, null);
});

Deno.test("resolvedor_entidade_d1: resolve croqui e entidade mesmo quando cidade e estado sao nulos", async () => {
  const banco = new BancoD1Fake();
  banco.inserirCroqui({
    croqui_uid: "CROQUI_SEM_LOC",
    id_slug: "br_sem_loc",
    nome: "Pico Isolado",
    cidade: null,
    estado: null,
  });
  banco.inserirEntidade({
    uid: "VIA_SEM_LOCAL1",
    tipo: "escalada",
    croqui_uid: "CROQUI_SEM_LOC",
    nome: "Via Isolada",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  const resumoCroqui = await resolverEntidadePorUid(banco, "CROQUI_SEM_LOC");
  assertEquals(resumoCroqui?.cidade, null);
  assertEquals(resumoCroqui?.estado, null);

  const resumoVia = await resolverEntidadePorUid(banco, "VIA_SEM_LOCAL1");
  assertEquals(resumoVia?.cidade, null);
  assertEquals(resumoVia?.estado, null);
  assertEquals(resumoVia?.escalada_grau, null);
  assertEquals(resumoVia?.escalada_tipo, null);
});

Deno.test("resolvedor_entidade_d1: retorna null quando UID nao existe ou pertence a tipo nao compartilhavel como botao", async () => {
  const banco = criarBancoPopulado();
  banco.inserirEntidade({
    uid: "BOTAO123456789",
    tipo: "botao",
    croqui_uid: "CROQUI12345678",
    nome: "Botão Interno",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  assertEquals(await resolverEntidadePorUid(banco, "INEXISTENTE123"), null);
  assertEquals(await resolverEntidadePorUid(banco, "BOTAO123456789"), null);
});
