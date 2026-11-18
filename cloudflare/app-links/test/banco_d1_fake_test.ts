// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { BancoD1Fake } from "./banco_d1_fake.ts";

Deno.test("banco_d1_fake: insere e consulta registros de catalogo_croquis e catalogo_aresta com JOIN e coordenadas em memoria", async () => {
  const banco = new BancoD1Fake();

  banco.inserirCroqui({
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    nome: " Serra do Cipó ",
    cidade: " Santana do Riacho ",
    estado: " MG ",
    latitude_e7: -193456780,
    longitude_e7: -436123450,
    url_google_maps: " https://maps.app.goo.gl/SerraDoCipo ",
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
    uid: "SETOR_ALFA1234",
    tipo: "setor",
    croqui_uid: "CROQUI12345678",
    nome: " Agua Limpa ",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  banco.inserirCroqui({
    croqui_uid: "CROQUI_MG_ALFA",
    id_slug: "br_mg_arcos_bombonera",
    nome: " Arcos Bombonera ",
    cidade: " Arcos ",
    estado: " MG ",
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
    .prepare(
      "SELECT croqui_uid, id_slug, nome, cidade, estado, latitude_e7, longitude_e7, url_google_maps FROM catalogo_croquis WHERE croqui_uid = ?"
    )
    .bind("CROQUI12345678")
    .all<{
      croqui_uid: string;
      id_slug: string;
      nome: string;
      cidade: string;
      estado: string;
      latitude_e7: number | null;
      longitude_e7: number | null;
      url_google_maps: string | null;
    }>();

  assertEquals(croquis.results, [
    {
      croqui_uid: "CROQUI12345678",
      id_slug: "br_mg_serra_do_cipo",
      nome: "Serra do Cipó",
      cidade: "Santana do Riacho",
      estado: "MG",
      latitude_e7: -193456780,
      longitude_e7: -436123450,
      url_google_maps: "https://maps.app.goo.gl/SerraDoCipo",
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

  const unificadoCroqui = await banco
    .prepare(
      "SELECT croqui_uid FROM catalogo_croquis WHERE croqui_uid = ? UNION ALL SELECT uid FROM catalogo_aresta WHERE uid = ?"
    )
    .bind("CROQUI12345678")
    .all<{ uid: string; tipo: string; croqui_nome: string; latitude_e7: number | null }>();
  assertEquals(unificadoCroqui.results[0].uid, "CROQUI12345678");
  assertEquals(unificadoCroqui.results[0].tipo, "croqui");
  assertEquals(unificadoCroqui.results[0].croqui_nome, "Serra do Cipó");
  assertEquals(unificadoCroqui.results[0].latitude_e7, -193456780);

  const unificadoEntidade = await banco
    .prepare(
      "SELECT croqui_uid FROM catalogo_croquis WHERE croqui_uid = ? UNION ALL SELECT uid FROM catalogo_aresta WHERE uid = ?"
    )
    .bind("ESCALA12345678")
    .all<{ uid: string; tipo: string; nome: string; setor_uid: string | null }>();
  assertEquals(unificadoEntidade.results[0].uid, "ESCALA12345678");
  assertEquals(unificadoEntidade.results[0].tipo, "escalada");
  assertEquals(unificadoEntidade.results[0].nome, "Rapa Nui");
  assertEquals(unificadoEntidade.results[0].setor_uid, "SETOR123456789");

  const agregados = await banco
    .prepare("SELECT c.croqui_uid, SUM(CASE WHEN e.tipo = 'setor' THEN 1 ELSE 0 END) AS total_setores FROM catalogo_croquis c LEFT JOIN catalogo_aresta e ON e.croqui_uid = c.croqui_uid GROUP BY c.croqui_uid")
    .all<{ croqui_uid: string; total_setores: number; total_escaladas: number }>();
  assertEquals(agregados.results.map((r) => r.croqui_uid), [
    "CROQUI_MG_ALFA",
    "CROQUI12345678",
  ]);
  assertEquals(agregados.results[1].total_setores, 2);
  assertEquals(agregados.results[1].total_escaladas, 1);

  const subSetores = await banco
    .prepare("SELECT e.uid FROM catalogo_aresta e WHERE e.croqui_uid = ? AND e.tipo IN ('grupo', 'setor')")
    .bind("CROQUI12345678")
    .all<{ uid: string }>();
  assertEquals(subSetores.results.map((r) => r.uid), [
    "SETOR_ALFA1234",
    "SETOR123456789",
  ]);

  const subVias = await banco
    .prepare("SELECT e.uid FROM catalogo_aresta e WHERE e.setor_uid = ? AND e.tipo = 'escalada'")
    .bind("SETOR123456789")
    .all<{ uid: string }>();
  assertEquals(subVias.results.map((r) => r.uid), ["ESCALA12345678"]);

  banco.inserirEntidade({
    uid: "ORFA_BUSCA1234",
    tipo: "escalada",
    croqui_uid: "INEXISTENTE123",
    nome: "Órfã",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });

  const todosBusca = await banco
    .prepare("SELECT c.croqui_uid AS uid, 'croqui' AS tipo FROM catalogo_croquis c UNION ALL SELECT e.uid AS uid, e.tipo AS tipo FROM catalogo_aresta e")
    .all<{ uid: string }>();
  assertEquals(todosBusca.results.length, 5);
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
    .all<{ cidade: string | null; estado: string | null; url_google_maps: string | null }>();
  assertEquals(croquiSemCidade.results[0].cidade, null);
  assertEquals(croquiSemCidade.results[0].estado, null);
  assertEquals(croquiSemCidade.results[0].url_google_maps, null);

  const unificadoSemCidade = await banco
    .prepare(
      "SELECT * FROM catalogo_croquis WHERE croqui_uid = ? UNION ALL SELECT * FROM catalogo_aresta WHERE uid = ?"
    )
    .bind("CROQUI_SEM_CID")
    .all<{ cidade: string | null; estado: string | null }>();
  assertEquals(unificadoSemCidade.results[0].cidade, null);
  assertEquals(unificadoSemCidade.results[0].estado, null);

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

  const queryDesconhecida = await banco.prepare("SELECT 1").all();
  assertEquals(queryDesconhecida.results, []);
});

Deno.test("banco_d1_fake: simula falha deterministica de I/O quando configurada e restaura operacao ao limpar falha", async () => {
  const banco = new BancoD1Fake();
  banco.configurarFalha("Falha simulada no Cloudflare D1");

  await assertRejects(
    async () => {
      await banco
        .prepare("SELECT * FROM catalogo_croquis WHERE croqui_uid = ?")
        .bind("X")
        .all();
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
