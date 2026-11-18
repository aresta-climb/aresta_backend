// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  renderizarPaginaEntidade,
  renderizarPaginaNaoEncontrada,
} from "../src/renderizador_pagina_link.ts";
import {
  MetadadosRotaLink,
  ResumoEntidadeLink,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";

const ROTA_COMPARTILHAMENTO: MetadadosRotaLink = {
  uid: "ESCALA12345678",
  prefixo: null,
  abrir_mapa: false,
  origem_link: "compartilhamento",
  utm_source: "compartilhamento",
  utm_medium: "social",
};

Deno.test("renderizador_pagina_link: gera meta tags OpenGraph, canonical /croquis/<uid>/<slug>, JSON-LD BreadcrumbList, breadcrumbs clicaveis e botao Google Maps", () => {
  const escalada: ResumoEntidadeLink = {
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
    setor_nome: "Vale da Lua",
    grupo_uid: "GRUPO123456789",
    grupo_nome: "Grupo Cipó",
    latitude_e7: -193456780,
    longitude_e7: -436123450,
    url_google_maps: "https://maps.app.goo.gl/SerraDoCipo",
  };

  const html = renderizarPaginaEntidade(escalada, ROTA_COMPARTILHAMENTO);

  assertStringIncludes(
    html,
    '<meta property="og:title" content="Rapa Nui (7b) — Serra do Cipó | Aresta">'
  );
  assertStringIncludes(
    html,
    '<link rel="canonical" href="https://arestaclimb.com/croquis/ESCALA12345678/mg-serra-do-cipo-rapa-nui">'
  );
  assertStringIncludes(html, '"@type":"BreadcrumbList"');
  assertStringIncludes(
    html,
    'href="/croquis/CROQUI12345678/mg-santana-do-riacho-serra-do-cipo"'
  );
  assertStringIncludes(
    html,
    'href="/croquis/GRUPO123456789/mg-serra-do-cipo-grupo-cipo"'
  );
  assertStringIncludes(
    html,
    'href="/croquis/SETOR123456789/mg-serra-do-cipo-vale-da-lua"'
  );
  assertStringIncludes(html, 'href="https://maps.app.goo.gl/SerraDoCipo"');
  assertStringIncludes(html, "Ver região no Google Maps");
  assertStringIncludes(
    html,
    '<meta property="og:image" content="https://aresta.cc/og/br_mg_serra_do_cipo.webp">'
  );

  const idxOgImage = html.indexOf('<meta property="og:image:height"');
  const idxPrimeiroScript = html.indexOf("<script>");
  const idxPrimeiroStyle = html.indexOf("<style>");
  assert(idxOgImage > 0 && idxOgImage < idxPrimeiroScript);
  assert(idxOgImage < idxPrimeiroStyle);
  assertStringIncludes(
    html,
    'href="aresta://arestaclimb.com/croquis/ESCALA12345678/mg-serra-do-cipo-rapa-nui"'
  );
});

Deno.test("renderizador_pagina_link: renderiza subentidades clicaveis em paginas de croqui, grupo e setor sem expor betas ou croquis riscados", () => {
  const rota: MetadadosRotaLink = {
    uid: "SETOR123456789",
    prefixo: null,
    abrir_mapa: false,
    origem_link: null,
    utm_source: null,
    utm_medium: null,
  };

  const setorComVias: ResumoEntidadeLink = {
    uid: "SETOR123456789",
    tipo: "setor",
    nome: "Setor Deslize",
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_sabara_pedra_rachada",
    croqui_nome: "Pedra Rachada",
    cidade: "Sabará",
    estado: "MG",
    escalada_grau: null,
    escalada_tipo: null,
    setor_nome: null,
    grupo_nome: null,
    latitude_e7: -198800000,
    longitude_e7: -438000000,
    url_google_maps: null,
    subentidades: [
      {
        uid: "VIA_DESLIZE_12",
        tipo: "escalada",
        nome: "Deslize",
        escalada_grau: "7a",
        escalada_tipo: "esportiva",
      },
      {
        uid: "BOULDER_SEM_GR",
        tipo: "escalada",
        nome: "Bloco Livre",
        escalada_grau: null,
        escalada_tipo: null,
      },
    ],
  };

  const htmlSetor = renderizarPaginaEntidade(setorComVias, rota);
  assertStringIncludes(htmlSetor, "Vias e Boulders deste Setor (2)");
  assertStringIncludes(
    htmlSetor,
    'href="/croquis/VIA_DESLIZE_12/mg-pedra-rachada-deslize"'
  );
  assertStringIncludes(htmlSetor, "7a");
  assertStringIncludes(htmlSetor, "Esportiva");
  assertStringIncludes(
    htmlSetor,
    "https://www.google.com/maps/search/?api=1&amp;query=-19.88,-43.8"
  );

  const croquiComSetores: ResumoEntidadeLink = {
    ...setorComVias,
    uid: "CROQUI12345678",
    tipo: "croqui",
    nome: "Pedra Rachada",
    subentidades: [
      { uid: "GRUPO_NORTE_12", tipo: "grupo", nome: "Grupo Norte" },
      {
        uid: "SETOR123456789",
        tipo: "setor",
        nome: "Setor Deslize",
        grupo_nome: "Grupo Norte",
      },
    ],
  };
  const htmlCroqui = renderizarPaginaEntidade(croquiComSetores, rota);
  assertStringIncludes(htmlCroqui, "Setores e Grupos deste Pico (2)");

  const grupoComSetores: ResumoEntidadeLink = {
    ...setorComVias,
    uid: "GRUPO_NORTE_12",
    tipo: "grupo",
    nome: "Grupo Norte",
    subentidades: [
      { uid: "SETOR123456789", tipo: "setor", nome: "Setor Deslize" },
    ],
  };
  const htmlGrupo = renderizarPaginaEntidade(grupoComSetores, rota);
  assertStringIncludes(htmlGrupo, "Setores deste Grupo (1)");
});

Deno.test("renderizador_pagina_link: formata modalidade com inicial maiuscula, usa etiqueta Boulder/Highline e remove prefixos Setor e Grupo duplicados", () => {
  const boulder: ResumoEntidadeLink = {
    uid: "BOULDER1234567",
    tipo: "escalada",
    nome: "Sobe e desce",
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_igarape_pedra_grande",
    croqui_nome: "Igarameca - Complexo Pedra Grande",
    cidade: "Igarapé",
    estado: "MG",
    escalada_grau: "VB",
    escalada_tipo: "boulder",
    setor_nome: "Setor Tramontina",
    grupo_nome: "Grupo Sherpa",
  };

  const htmlBoulder = renderizarPaginaEntidade(boulder, ROTA_COMPARTILHAMENTO);

  assertStringIncludes(
    htmlBoulder,
    "Boulder • Modalidade: Boulder • Setor: Tramontina • Grupo: Sherpa"
  );
  assertEquals(htmlBoulder.includes("Setor: Setor Tramontina"), false);
  assertEquals(htmlBoulder.includes("Grupo: Grupo Sherpa"), false);

  const highline: ResumoEntidadeLink = {
    ...boulder,
    uid: "HIGHLINE123456",
    nome: "Travessia do Céu",
    escalada_grau: "80m",
    escalada_tipo: "highline",
    setor_nome: "Setor",
    grupo_nome: "Grupo",
  };

  const htmlHighline = renderizarPaginaEntidade(
    highline,
    ROTA_COMPARTILHAMENTO
  );
  assertStringIncludes(
    htmlHighline,
    "Highline • Modalidade: Highline • Setor: Setor • Grupo: Grupo"
  );
});

Deno.test("renderizador_pagina_link: gera titulo OpenGraph adequado para croqui, setor, grupo e escalada sem grau, usando fallback de imagem quando id_slug for vazio", () => {
  const rotaDireta: MetadadosRotaLink = {
    uid: "CROQUI12345678",
    prefixo: null,
    abrir_mapa: false,
    origem_link: null,
    utm_source: null,
    utm_medium: null,
  };

  const croqui: ResumoEntidadeLink = {
    uid: "CROQUI12345678",
    tipo: "croqui",
    nome: "Serra do Cipó",
    croqui_uid: "CROQUI12345678",
    id_slug: "",
    croqui_nome: "Serra do Cipó",
    cidade: "Santana do Riacho",
    estado: null,
    escalada_grau: null,
    escalada_tipo: null,
    setor_nome: null,
    grupo_nome: null,
  };

  const htmlCroqui = renderizarPaginaEntidade(croqui, rotaDireta);
  assertStringIncludes(
    htmlCroqui,
    '<meta property="og:title" content="Serra do Cipó | Aresta Croquis de Escalada">'
  );
  assertStringIncludes(
    htmlCroqui,
    '<meta property="og:image" content="https://arestaclimb.com/og.png">'
  );
  assertStringIncludes(
    htmlCroqui,
    '<meta property="og:image:type" content="image/png">'
  );

  const setor: ResumoEntidadeLink = {
    ...croqui,
    uid: "SETOR123456789",
    tipo: "setor",
    nome: "Setor Sul",
    cidade: null,
    estado: "MG",
  };
  const htmlSetor = renderizarPaginaEntidade(setor, {
    ...rotaDireta,
    uid: "SETOR123456789",
    abrir_mapa: true,
  });
  assertStringIncludes(
    htmlSetor,
    '<meta property="og:title" content="Setor Sul — Serra do Cipó | Aresta">'
  );
  assertStringIncludes(htmlSetor, "Mapa interativo");

  const grupo: ResumoEntidadeLink = {
    ...croqui,
    uid: "GRUPO123456789",
    tipo: "grupo",
    nome: "Grupo Norte",
    cidade: null,
    estado: null,
  };
  const htmlGrupo = renderizarPaginaEntidade(grupo, rotaDireta);
  assertStringIncludes(
    htmlGrupo,
    '<meta property="og:title" content="Grupo Norte — Serra do Cipó | Aresta">'
  );

  const escaladaSemGrau: ResumoEntidadeLink = {
    ...croqui,
    uid: "ESCALA_SEM_GR1",
    tipo: "escalada",
    nome: "Via Livre",
  };
  const htmlEscaladaSemGrau = renderizarPaginaEntidade(
    escaladaSemGrau,
    rotaDireta
  );
  assertStringIncludes(
    htmlEscaladaSemGrau,
    '<meta property="og:title" content="Via Livre — Serra do Cipó | Aresta">'
  );
});

Deno.test("renderizador_pagina_link: inclui script do Umami que le window.location.search para mapa e UTMs e atualiza link aresta://", () => {
  const entidade: ResumoEntidadeLink = {
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
    setor_nome: null,
    grupo_nome: null,
  };

  const rotaQrMapa: MetadadosRotaLink = {
    uid: "ESCALA12345678",
    prefixo: null,
    abrir_mapa: true,
    origem_link: "qrcode",
    utm_source: "placa_rocha",
    utm_medium: "qrcode",
  };

  const html = renderizarPaginaEntidade(entidade, rotaQrMapa);

  assertStringIncludes(
    html,
    'src="https://analytics.arestaclimb.com/script.js"'
  );
  assertStringIncludes(html, "app-link-acesso");
  assertStringIncludes(html, 'params.get("mapa")');
  assertStringIncludes(html, "linkAbrirAppMobile");
});

Deno.test("renderizador_pagina_link: escapa caracteres especiais HTML contra XSS em todos os campos interpolados", () => {
  const entidadeMaliciosa: ResumoEntidadeLink = {
    uid: "ESCALA12345678",
    tipo: "escalada",
    nome: '<script>alert("xss")</script> & \'Via\'',
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_cipo",
    croqui_nome: 'Croqui "Perigoso" <1>',
    cidade: "Cidade <X>",
    estado: "MG",
    escalada_grau: "7b",
    escalada_tipo: "esportiva",
    setor_nome: null,
    grupo_nome: null,
  };

  const html = renderizarPaginaEntidade(
    entidadeMaliciosa,
    ROTA_COMPARTILHAMENTO
  );

  assertEquals(html.includes('<script>alert("xss")</script>'), false);
  assertStringIncludes(
    html,
    "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;Via&#39;"
  );
});

Deno.test("renderizador_pagina_link: aplica Design System Light/Dark, store badges com SVG e pagina 404 apontando para /croquis", () => {
  const escalada: ResumoEntidadeLink = {
    uid: "BOULDER1234567",
    tipo: "escalada",
    nome: "Sobe e desce",
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_igarape_pedra_grande",
    croqui_nome: "Igarameca - Complexo Pedra Grande",
    cidade: "Igarapé",
    estado: "MG",
    escalada_grau: "VB",
    escalada_tipo: "boulder",
    setor_nome: "Setor Tramontina",
    grupo_nome: null,
  };

  const html = renderizarPaginaEntidade(escalada, ROTA_COMPARTILHAMENTO);

  assertStringIncludes(html, 'data-theme="dark"');
  assertStringIncludes(html, 'id="themeToggle"');
  assertStringIncludes(html, 'class="store-badge"');
  assertStringIncludes(
    html,
    "app-id=6776467893, app-argument=https://arestaclimb.com/croquis/BOULDER1234567/"
  );

  const html404 = renderizarPaginaNaoEncontrada();
  assertStringIncludes(html404, "Link não encontrado");
  assertStringIncludes(html404, "https://arestaclimb.com/croquis");
});
