// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  listarCroquisVitrine,
  listarItensBuscaESitemap,
  resolverEntidadePorUid,
} from "../src/resolvedor_entidade_d1.ts";
import { BancoD1Fake } from "./banco_d1_fake.ts";

function criarBancoPopulado(): BancoD1Fake {
  const banco = new BancoD1Fake();

  banco.inserirCroqui({
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    nome: "Serra do Cipó",
    cidade: "Santana do Riacho",
    estado: "MG",
    latitude_e7: -193456780,
    longitude_e7: -436123450,
    url_google_maps: "https://maps.app.goo.gl/SerraDoCipo",
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

Deno.test("resolvedor_entidade_d1: resolve UID de croqui incluindo coordenadas e url_google_maps sem buscar filhos por padrao", async () => {
  const banco = criarBancoPopulado();

  const resumo = await resolverEntidadePorUid(banco, "CROQUI12345678");

  assertEquals(banco.totalConsultasExecutadas, 1);
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
    setor_uid: null,
    setor_nome: null,
    grupo_uid: null,
    grupo_nome: null,
    latitude_e7: -193456780,
    longitude_e7: -436123450,
    url_google_maps: "https://maps.app.goo.gl/SerraDoCipo",
  });
});

Deno.test("resolvedor_entidade_d1: resolve UID de escalada com JOIN completo em uma unica consulta SQL mesmo com incluirSubentidades true", async () => {
  const banco = criarBancoPopulado();

  const resumo = await resolverEntidadePorUid(banco, "ESCALA12345678", {
    incluirSubentidades: true,
  });

  assertEquals(banco.totalConsultasExecutadas, 1);
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
    setor_uid: "SETOR123456789",
    setor_nome: "Setor Vale da Lua",
    grupo_uid: "GRUPO123456789",
    grupo_nome: "Grupo Principal",
    latitude_e7: -193456780,
    longitude_e7: -436123450,
    url_google_maps: "https://maps.app.goo.gl/SerraDoCipo",
    subentidades: [],
  });
});

Deno.test("resolvedor_entidade_d1: carrega subentidades filhas para croqui, grupo e setor quando solicitado", async () => {
  const banco = criarBancoPopulado();

  const resumoCroqui = await resolverEntidadePorUid(banco, "CROQUI12345678", {
    incluirSubentidades: true,
  });
  assertEquals(resumoCroqui?.subentidades?.map((s) => s.uid), [
    "GRUPO123456789",
    "SETOR123456789",
  ]);

  const resumoGrupo = await resolverEntidadePorUid(banco, "GRUPO123456789", {
    incluirSubentidades: true,
  });
  assertEquals(resumoGrupo?.subentidades?.map((s) => s.uid), [
    "SETOR123456789",
  ]);

  const resumoSetor = await resolverEntidadePorUid(banco, "SETOR123456789", {
    incluirSubentidades: true,
  });
  assertEquals(resumoSetor?.grupo_uid, "GRUPO123456789");
  assertEquals(resumoSetor?.grupo_nome, "Grupo Principal");
  assertEquals(resumoSetor?.subentidades?.map((s) => s.uid), [
    "ESCALA12345678",
  ]);
  assertEquals(resumoSetor?.subentidades?.[0].escalada_grau, "7b");
});

Deno.test("resolvedor_entidade_d1: resolve croqui e entidade mesmo quando cidade, estado e coordenadas sao nulos", async () => {
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
  assertEquals(resumoCroqui?.latitude_e7, null);
  assertEquals(resumoCroqui?.url_google_maps, null);

  const resumoVia = await resolverEntidadePorUid(banco, "VIA_SEM_LOCAL1");
  assertEquals(resumoVia?.cidade, null);
  assertEquals(resumoVia?.estado, null);
  assertEquals(resumoVia?.escalada_grau, null);
  assertEquals(resumoVia?.escalada_tipo, null);
});

Deno.test("resolvedor_entidade_d1: retorna null quando UID nao existe ou pertence a botao", async () => {
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

Deno.test("resolvedor_entidade_d1: listarCroquisVitrine agrega setores e escaladas ordenando por estado e nome", async () => {
  const banco = criarBancoPopulado();
  banco.inserirCroqui({
    croqui_uid: "CROQUI_RJ_1234",
    id_slug: "br_rj_capelinha",
    nome: "Capelinha",
    cidade: "Nova Friburgo",
    estado: "RJ",
    latitude_e7: -222800000,
    longitude_e7: -425300000,
    url_google_maps: null,
  });
  banco.inserirCroqui({
    croqui_uid: "CROQUI_SEM_UF1",
    id_slug: "br_xx_isolado",
    nome: "Afloramento Z",
    cidade: null,
    estado: null,
  });

  const lista = await listarCroquisVitrine(banco);
  assertEquals(
    lista.map((c) => c.croqui_uid),
    ["CROQUI12345678", "CROQUI_RJ_1234", "CROQUI_SEM_UF1"]
  );
  assertEquals(lista[0].total_setores, 1);
  assertEquals(lista[0].total_escaladas, 1);
  assertEquals(lista[0].latitude_e7, -193456780);
  assertEquals(lista[1].total_setores, 0);
  assertEquals(lista[1].total_escaladas, 0);
});

Deno.test("resolvedor_entidade_d1: listarItensBuscaESitemap retorna croquis, grupos, setores e escaladas com slug canonico e ignora botoes", async () => {
  const banco = criarBancoPopulado();
  banco.inserirCroqui({
    croqui_uid: "CROQUI_SO_UF12",
    id_slug: "br_sp_pedra",
    nome: "Pedra Bela",
    cidade: null,
    estado: "SP",
  });
  banco.inserirEntidade({
    uid: "BOTAO_IGNORADO",
    tipo: "botao",
    croqui_uid: "CROQUI12345678",
    nome: "Pix",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  const itens = await listarItensBuscaESitemap(banco);
  assertEquals(itens.some((i) => i.uid === "BOTAO_IGNORADO"), false);
  assertEquals(itens.length, 5);

  const itemVia = itens.find((i) => i.uid === "ESCALA12345678");
  assertEquals(itemVia, {
    uid: "ESCALA12345678",
    tipo: "escalada",
    nome: "Rapa Nui",
    grau: "7b",
    modalidade: "esportiva",
    croqui_nome: "Serra do Cipó",
    localizacao: "Santana do Riacho - MG",
    slug: "mg-serra-do-cipo-rapa-nui",
  });

  const itemSp = itens.find((i) => i.uid === "CROQUI_SO_UF12");
  assertEquals(itemSp?.localizacao, "SP");
});
