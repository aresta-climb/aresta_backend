// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
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
  prefixo: "s",
  abrir_mapa: false,
  origem_link: "compartilhamento",
  utm_source: "compartilhamento",
  utm_medium: "social",
};

Deno.test("renderizador_pagina_link: gera meta tags OpenGraph completas e thumbnail da CDN para escalada com grau", () => {
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
    setor_nome: "Vale da Lua",
    grupo_nome: "Grupo Cipó",
  };

  const html = renderizarPaginaEntidade(escalada, ROTA_COMPARTILHAMENTO);

  assertStringIncludes(
    html,
    '<meta property="og:title" content="Rapa Nui (7b) — Serra do Cipó | Aresta">'
  );
  assertStringIncludes(
    html,
    '<meta property="og:image" content="https://serving.arestaclimb.com/v4/thumbnails/br_mg_serra_do_cipo.webp">'
  );
  assertStringIncludes(html, "Vale da Lua");
  assertStringIncludes(html, "Grupo Cipó");
  assertStringIncludes(html, "Santana do Riacho - MG");
  assertStringIncludes(html, "esportiva");
  assertStringIncludes(html, 'href="aresta://aresta.cc/s/ESCALA12345678"');
  assertStringIncludes(html, "https://apps.apple.com/app/id6776467893");
  assertStringIncludes(
    html,
    "https://play.google.com/store/apps/details?id=app.escalada.croquis"
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
  assertStringIncludes(htmlCroqui, 'href="aresta://aresta.cc/CROQUI12345678"');
  assertStringIncludes(htmlCroqui, "Santana do Riacho");

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
    prefixo: "m",
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

Deno.test("renderizador_pagina_link: inclui script do Umami e payload de telemetria app-link-acesso com utm_source e utm_medium", () => {
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
    prefixo: "qm",
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
  assertStringIncludes(
    html,
    'data-website-id="3ba79f5e-e49f-42d4-9283-586976189124"'
  );
  assertStringIncludes(html, "app-link-acesso");
  assertStringIncludes(html, '"utm_source":"placa_rocha"');
  assertStringIncludes(html, '"utm_medium":"qrcode"');
  assertStringIncludes(html, '"abrir_mapa":true');
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

Deno.test("renderizador_pagina_link: renderiza pagina 404 amigavel com links para o site e lojas", () => {
  const html404 = renderizarPaginaNaoEncontrada();

  assertStringIncludes(html404, "Link não encontrado");
  assertStringIncludes(html404, "https://arestaclimb.com");
  assertStringIncludes(html404, "https://apps.apple.com/app/id6776467893");
  assertStringIncludes(
    html404,
    "https://play.google.com/store/apps/details?id=app.escalada.croquis"
  );
});
