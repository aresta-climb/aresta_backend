// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  renderizarPaginaIndiceVitrine,
  renderizarSitemapVitrine,
} from "../src/renderizador_vitrine_indice.ts";
import {
  ItemBuscaVitrine,
  ResumoCroquiVitrine,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";

Deno.test("renderizador_vitrine_indice: gera sitemap XML com /croquis e todas as URLs canonicas escapadas", () => {
  const itens: ItemBuscaVitrine[] = [
    {
      uid: "CROQUI12345678",
      tipo: "croqui",
      nome: "Pedra Rachada",
      grau: null,
      modalidade: null,
      croqui_nome: "Pedra Rachada",
      localizacao: "Sabará - MG",
      slug: "mg-sabara-pedra-rachada",
    },
    {
      uid: "ESCALA12345678",
      tipo: "escalada",
      nome: "Feijão & Linguiça",
      grau: "7a",
      modalidade: "esportiva",
      croqui_nome: "Pedra Rachada",
      localizacao: "Sabará - MG",
      slug: "mg-pedra-rachada-feijao-linguica",
    },
  ];

  const xml = renderizarSitemapVitrine(itens);
  assertStringIncludes(xml, '<?xml version="1.0" encoding="UTF-8"?>');
  assertStringIncludes(xml, "<loc>https://arestaclimb.com/croquis</loc>");
  assertStringIncludes(
    xml,
    "<loc>https://arestaclimb.com/croquis/CROQUI12345678/mg-sabara-pedra-rachada</loc>"
  );
  assertStringIncludes(
    xml,
    "<loc>https://arestaclimb.com/croquis/ESCALA12345678/mg-pedra-rachada-feijao-linguica</loc>"
  );
});

Deno.test("renderizador_vitrine_indice: renderiza pagina /croquis com Mapao Leaflet, busca lazy busca.json e agrupamento por estado", () => {
  const croquis: ResumoCroquiVitrine[] = [
    {
      croqui_uid: "CROQUI_MG_1234",
      id_slug: "br_mg_sabara_pedra_rachada",
      nome: "Pedra Rachada",
      cidade: "Sabará",
      estado: "MG",
      latitude_e7: -198800000,
      longitude_e7: -438000000,
      url_google_maps: "https://maps.app.goo.gl/PedraRachada",
      total_setores: 12,
      total_escaladas: 180,
    },
    {
      croqui_uid: "CROQUI_SEM_GEO",
      id_slug: "",
      nome: "Pico Misterioso",
      cidade: null,
      estado: null,
      latitude_e7: null,
      longitude_e7: null,
      url_google_maps: null,
      total_setores: 1,
      total_escaladas: 1,
    },
  ];

  const html = renderizarPaginaIndiceVitrine(croquis);

  assertStringIncludes(
    html,
    '<link rel="canonical" href="https://arestaclimb.com/croquis">'
  );
  assertStringIncludes(html, 'id="campoBuscaVitrine"');
  assertStringIncludes(html, "/croquis/busca.json");
  assertStringIncludes(html, 'id="mapaVitrineCroquis"');
  assertStringIncludes(html, "leaflet");
  assertStringIncludes(html, "cartocdn.com");
  assertStringIncludes(
    html,
    "/croquis/CROQUI_MG_1234/mg-sabara-pedra-rachada"
  );
  assertStringIncludes(html, "Sabará - MG");
  assertStringIncludes(html, "12 setores");
  assertStringIncludes(html, "180 escaladas");
  assertStringIncludes(html, "1 setor");
  assertStringIncludes(html, "1 escalada");
  assertStringIncludes(html, "Outros");
});

Deno.test("renderizador_vitrine_indice: exibe estado vazio amigavel quando nao ha croquis cadastrados", () => {
  const htmlVazio = renderizarPaginaIndiceVitrine([]);
  assertStringIncludes(htmlVazio, "Nenhum croqui publicado no momento");
  assertEquals(htmlVazio.includes('id="mapaVitrineCroquis"'), false);
});
