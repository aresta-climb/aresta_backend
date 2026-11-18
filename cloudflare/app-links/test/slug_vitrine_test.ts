// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  construirCaminhoVitrineEntidade,
  construirSlugCanonicoEntidade,
  construirUrlCanonicaVitrine,
  construirUrlRedirecionamentoArestaCc,
  resolverUrlGoogleMapsCroqui,
  slugificarTexto,
} from "../src/slug_vitrine.ts";
import { MetadadosRotaLink } from "../../../aresta_api/openapi/generated/ts/app_links.ts";

Deno.test("slug_vitrine: slugificarTexto remove acentos, pontuacao e retorna fallback quando vazio", () => {
  assertEquals(
    slugificarTexto("Feijão com Linguiça (7a/7b)!"),
    "feijao-com-linguica-7a-7b"
  );
  assertEquals(slugificarTexto("  São Thomé  --  MG "), "sao-thome-mg");
  assertEquals(slugificarTexto("!!!"), "item");
});

Deno.test("slug_vitrine: construirSlugCanonicoEntidade monta slug com UF, croqui e nome sem duplicar cidade", () => {
  assertEquals(
    construirSlugCanonicoEntidade({
      tipo: "escalada",
      nome: "Feijão com Linguiça",
      croqui_nome: "Pedra Rachada",
      cidade: "Sabará",
      estado: "MG",
    }),
    "mg-pedra-rachada-feijao-com-linguica"
  );

  assertEquals(
    construirSlugCanonicoEntidade({
      tipo: "croqui",
      nome: "Pedra Rachada",
      croqui_nome: "Pedra Rachada",
      cidade: "Sabará",
      estado: "MG",
    }),
    "mg-sabara-pedra-rachada"
  );

  assertEquals(
    construirSlugCanonicoEntidade({
      tipo: "croqui",
      nome: "Monte Alvão - Caeté",
      croqui_nome: "Monte Alvão - Caeté",
      cidade: "Caeté",
      estado: "MG",
    }),
    "mg-monte-alvao-caete"
  );

  assertEquals(
    construirSlugCanonicoEntidade({
      tipo: "setor",
      nome: "Vale da Lua",
      croqui_nome: "Serra do Cipó",
      cidade: null,
      estado: null,
    }),
    "serra-do-cipo-vale-da-lua"
  );
});

Deno.test("slug_vitrine: constroi caminho e URL canonica com UID de 14 caracteres na frente", () => {
  assertEquals(
    construirCaminhoVitrineEntidade("x8siJek3FiG3aB", "mg-pedra-rachada"),
    "/croquis/x8siJek3FiG3aB/mg-pedra-rachada"
  );
  assertEquals(
    construirUrlCanonicaVitrine({
      uid: "x8siJek3FiG3aB",
      tipo: "escalada",
      nome: "Deslize",
      croqui_nome: "Pedra Rachada",
      cidade: "Sabará",
      estado: "MG",
    }),
    "https://arestaclimb.com/croquis/x8siJek3FiG3aB/mg-pedra-rachada-deslize"
  );
});

Deno.test("slug_vitrine: construirUrlRedirecionamentoArestaCc preserva CGI args extras e injeta mapa e UTMs do prefixo sem sobrescrever explicitos", () => {
  const rotaSm: MetadadosRotaLink = {
    uid: "x8siJek3FiG3aB",
    prefixo: "sm",
    abrir_mapa: true,
    origem_link: "compartilhamento",
    utm_source: "compartilhamento",
    utm_medium: "social",
  };

  const urlComPrefixo = construirUrlRedirecionamentoArestaCc(
    new URL("https://aresta.cc/sm/x8siJek3FiG3aB?campanha=inverno"),
    rotaSm,
    "https://arestaclimb.com/croquis/x8siJek3FiG3aB/mg-pedra-rachada-deslize"
  );
  assertEquals(
    urlComPrefixo,
    "https://arestaclimb.com/croquis/x8siJek3FiG3aB/mg-pedra-rachada-deslize?campanha=inverno&mapa=1&utm_source=compartilhamento&utm_medium=social"
  );

  const rotaExplicita: MetadadosRotaLink = {
    uid: "x8siJek3FiG3aB",
    prefixo: null,
    abrir_mapa: false,
    origem_link: null,
    utm_source: "instagram",
    utm_medium: "bio",
  };
  const urlExplicita = construirUrlRedirecionamentoArestaCc(
    new URL(
      "https://aresta.cc/x8siJek3FiG3aB?utm_source=instagram&utm_medium=bio&mapa=0"
    ),
    rotaExplicita,
    "https://arestaclimb.com/croquis/x8siJek3FiG3aB/mg-pedra-rachada-deslize"
  );
  assertEquals(
    urlExplicita,
    "https://arestaclimb.com/croquis/x8siJek3FiG3aB/mg-pedra-rachada-deslize?utm_source=instagram&utm_medium=bio&mapa=0"
  );
});

Deno.test("slug_vitrine: resolverUrlGoogleMapsCroqui prioriza url_google_maps explicita e faz fallback para coordenadas E7", () => {
  assertEquals(
    resolverUrlGoogleMapsCroqui({
      latitude_e7: -198800000,
      longitude_e7: -438000000,
      url_google_maps: " https://maps.app.goo.gl/PedraRachada ",
    }),
    "https://maps.app.goo.gl/PedraRachada"
  );

  assertEquals(
    resolverUrlGoogleMapsCroqui({
      latitude_e7: -201176660,
      longitude_e7: -443593480,
      url_google_maps: null,
    }),
    "https://www.google.com/maps/search/?api=1&query=-20.117666,-44.359348"
  );

  assertEquals(
    resolverUrlGoogleMapsCroqui({
      latitude_e7: 0,
      longitude_e7: 0,
      url_google_maps: "invalida-sem-http",
    }),
    null
  );

  assertEquals(
    resolverUrlGoogleMapsCroqui({
      latitude_e7: null,
      longitude_e7: null,
      url_google_maps: null,
    }),
    null
  );
});
