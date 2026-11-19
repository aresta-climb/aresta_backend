// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ItemBuscaVitrine,
  ResumoCroquiVitrine,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";
import {
  ESTILOS_BASE_DESIGN_SYSTEM,
  ID_WEBSITE_UMAMI,
  SCRIPT_ALTERNANCIA_TEMA,
  SCRIPT_INICIALIZACAO_TEMA,
  URL_BASE_THUMBNAILS_OG,
  URL_IMAGEM_PADRAO_OG,
  URL_SCRIPT_UMAMI,
  URL_VITRINE_CROQUIS,
  escaparHtml,
  formatarLocalizacao,
  renderizarBotoesLojas,
  renderizarCabecalhoSite,
  renderizarRodapeSite,
} from "./renderizador_pagina_link.ts";
import {
  DOMINIO_VITRINE_CANONICO,
  construirCaminhoVitrineEntidade,
  construirSlugCanonicoEntidade,
  resolverUrlGoogleMapsCroqui,
} from "./slug_vitrine.ts";

/**
 * Gera o documento XML (`sitemap.xml`) contendo `/croquis` e todas as entidades públicas.
 */
export function renderizarSitemapVitrine(itens: ItemBuscaVitrine[]): string {
  const urlsXml: string[] = [
    `  <url>\n    <loc>${escaparHtml(URL_VITRINE_CROQUIS)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  ];

  for (const item of itens) {
    const loc = `${DOMINIO_VITRINE_CANONICO}${construirCaminhoVitrineEntidade(item.uid, item.slug)}`;
    const prioridade =
      item.tipo === "croqui" ? "0.9" : item.tipo === "setor" ? "0.7" : "0.6";
    urlsXml.push(
      `  <url>\n    <loc>${escaparHtml(loc)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${prioridade}</priority>\n  </url>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml.join("\n")}\n</urlset>\n`;
}

interface PinoMapaCroqui {
  nome: string;
  local: string | null;
  lat: number;
  lng: number;
  href: string;
  urlMaps: string | null;
  setores: number;
  escaladas: number;
}

/**
 * Renderiza a página índice `GET https://arestaclimb.com/croquis` unindo Mapão nacional leve,
 * busca instantânea client-side (`/croquis/busca.json` sob demanda) e diretório HTML por estado.
 */
export function renderizarPaginaIndiceVitrine(
  croquis: ResumoCroquiVitrine[]
): string {
  const totalCroquis = croquis.length;
  const totalEscaladasGlobal = croquis.reduce(
    (acc, c) => acc + c.total_escaladas,
    0
  );

  const gruposPorEstado = new Map<string, ResumoCroquiVitrine[]>();
  const pinosMapa: PinoMapaCroqui[] = [];

  for (const c of croquis) {
    const chaveEstado = c.estado?.trim() || "Outros";
    const listaAtual = gruposPorEstado.get(chaveEstado) ?? [];
    listaAtual.push(c);
    gruposPorEstado.set(chaveEstado, listaAtual);

    const slug = construirSlugCanonicoEntidade({
      tipo: "croqui",
      nome: c.nome,
      croqui_nome: c.nome,
      cidade: c.cidade ?? null,
      estado: c.estado ?? null,
    });
    const href = construirCaminhoVitrineEntidade(c.croqui_uid, slug);

    if (
      c.latitude_e7 !== null &&
      c.latitude_e7 !== undefined &&
      c.longitude_e7 !== null &&
      c.longitude_e7 !== undefined &&
      (c.latitude_e7 !== 0 || c.longitude_e7 !== 0)
    ) {
      pinosMapa.push({
        nome: c.nome,
        local: formatarLocalizacao(c.cidade ?? null, c.estado ?? null),
        lat: Number((c.latitude_e7 / 1e7).toFixed(6)),
        lng: Number((c.longitude_e7 / 1e7).toFixed(6)),
        href,
        urlMaps: resolverUrlGoogleMapsCroqui(c),
        setores: c.total_setores,
        escaladas: c.total_escaladas,
      });
    }
  }

  const ufsDisponiveis = Array.from(gruposPorEstado.keys());
  const temMapa = pinosMapa.length > 0;

  const chipsUfHtml =
    ufsDisponiveis.length > 1
      ? `<div class="filtros-uf" role="group" aria-label="Filtrar por estado">
          <button type="button" class="chip-uf ativo" data-uf-filtro="">Todos (${totalCroquis})</button>
          ${ufsDisponiveis
            .map(
              (uf) =>
                `<button type="button" class="chip-uf" data-uf-filtro="${escaparHtml(uf)}">${escaparHtml(uf)} (${gruposPorEstado.get(uf)!.length})</button>`
            )
            .join("")}
        </div>`
      : "";

  const secoesEstadosHtml: string[] = [];
  for (const [uf, listaCroquis] of gruposPorEstado.entries()) {
    const cardsHtml = listaCroquis.map((c) => {
      const slug = construirSlugCanonicoEntidade({
        tipo: "croqui",
        nome: c.nome,
        croqui_nome: c.nome,
        cidade: c.cidade ?? null,
        estado: c.estado ?? null,
      });
      const href = construirCaminhoVitrineEntidade(c.croqui_uid, slug);
      const local =
        formatarLocalizacao(c.cidade ?? null, c.estado ?? null) ??
        "Brasil";
      const thumb = c.id_slug
        ? `${URL_BASE_THUMBNAILS_OG}/${encodeURIComponent(c.id_slug)}.webp`
        : URL_IMAGEM_PADRAO_OG;
      const textoSetores =
        c.total_setores === 1 ? "1 setor" : `${c.total_setores} setores`;
      const textoEscaladas =
        c.total_escaladas === 1
          ? "1 escalada"
          : `${c.total_escaladas} escaladas`;

      return `<a class="card-pico-vitrine" href="${escaparHtml(href)}" data-busca="${escaparHtml(`${c.nome} ${local}`.toLowerCase())}">
              <img class="thumb-pico-vitrine" src="${escaparHtml(thumb)}" alt="${escaparHtml(c.nome)}" loading="lazy" width="88" height="88">
              <div class="info-pico-vitrine">
                <strong>${escaparHtml(c.nome)}</strong>
                <span class="local-pico-vitrine">${escaparHtml(local)}</span>
                <div class="metricas-pico-vitrine">
                  <span>${textoSetores}</span>
                  <span>•</span>
                  <span>${textoEscaladas}</span>
                </div>
              </div>
            </a>`;
    });

    secoesEstadosHtml.push(
      `<section class="secao-uf" data-secao-uf="${escaparHtml(uf)}">
          <div class="cabecalho-uf">
            <h2>${escaparHtml(uf)}</h2>
            <span>${listaCroquis.length} ${listaCroquis.length === 1 ? "guia" : "guias"}</span>
          </div>
          <div class="grade-picos">
            ${cardsHtml.join("\n            ")}
          </div>
        </section>`
    );
  }

  const conteudoPrincipalHtml =
    totalCroquis === 0
      ? `<p class="estado-vazio">Nenhum croqui publicado no momento.</p>`
      : secoesEstadosHtml.join("\n        ");

  const maplibreHeadHtml = temMapa
    ? `<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.3.0/dist/maplibre-gl.css" crossorigin="">`
    : "";

  const blocoMapaHtml = temMapa
    ? `<section class="painel-mapa" aria-label="Mapa de picos de escalada">
          <div id="mapaVitrineCroquis" class="mapa-vitrine"></div>
        </section>`
    : "";

  const scriptMapaJson = JSON.stringify(pinosMapa).replace(/</g, "\\u003c");
  const scriptMaplibreHtml = temMapa
    ? `<script defer src="https://unpkg.com/maplibre-gl@5.3.0/dist/maplibre-gl.js" crossorigin=""></script>`
    : "";

  const titulo = "Croquis de Escalada no Brasil | Aresta Climb";
  const descricao = `Explore ${totalCroquis} guias de escalada e ${totalEscaladasGlobal} vias e boulders catalogados no Aresta Climb. Encontre picos no mapa e baixe croquis 100% offline no aplicativo.`;

  return `<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escaparHtml(titulo)}</title>
  <meta name="description" content="${escaparHtml(descricao)}">
  <link rel="canonical" href="${URL_VITRINE_CROQUIS}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:site_name" content="Aresta Croquis de Escalada">
  <meta property="og:title" content="${escaparHtml(titulo)}">
  <meta property="og:description" content="${escaparHtml(descricao)}">
  <meta property="og:url" content="${URL_VITRINE_CROQUIS}">
  <meta property="og:image" content="${URL_IMAGEM_PADRAO_OG}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="https://arestaclimb.com/favicon.svg">
  ${SCRIPT_INICIALIZACAO_TEMA}
  ${maplibreHeadHtml}
  <script defer src="${URL_SCRIPT_UMAMI}" data-website-id="${ID_WEBSITE_UMAMI}"></script>
  ${scriptMaplibreHtml}
  <style>${ESTILOS_BASE_DESIGN_SYSTEM}
    .vitrine-main {
      flex: 1;
      width: 100%;
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 20px 56px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .hero-vitrine {
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 24px;
      box-shadow: var(--shadow-sm);
    }
    .hero-vitrine h1 {
      font-size: clamp(26px, 5vw, 36px);
      font-weight: 900;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    .hero-vitrine p {
      color: var(--muted);
      font-size: 14.5px;
      margin-top: 6px;
    }
    .barra-pesquisa-wrap {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .campo-busca {
      width: 100%;
      padding: 13px 16px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--text);
      font-size: 15px;
      outline: none;
    }
    .campo-busca:focus {
      border-color: var(--accent);
    }
    .dropdown-busca {
      display: none;
      list-style: none;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow);
      max-height: 340px;
      overflow-y: auto;
      divide-y: 1px solid var(--line);
    }
    .dropdown-busca.visivel {
      display: block;
    }
    .item-resultado-busca {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 16px;
      border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
    }
    .item-resultado-busca:hover {
      background: var(--bg-soft);
    }
    .res-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .res-info strong {
      font-size: 14px;
      font-weight: 750;
    }
    .res-info span {
      font-size: 12px;
      color: var(--muted);
    }
    .res-badge {
      padding: 3px 9px;
      border-radius: var(--radius-full);
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      color: var(--accent);
      font-size: 11.5px;
      font-weight: 800;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .filtros-uf {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip-uf {
      padding: 6px 13px;
      border-radius: var(--radius-full);
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
    }
    .chip-uf.ativo, .chip-uf:hover {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      color: var(--accent);
    }
    .painel-mapa {
      border-radius: var(--radius-lg);
      overflow: hidden;
      border: 1px solid var(--line);
      box-shadow: var(--shadow-sm);
      background: var(--bg-soft);
    }
    .mapa-vitrine {
      width: 100%;
      height: 360px;
      z-index: 1;
    }
    .pino-mapa-aresta {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--accent);
      border: 2.5px solid #ffffff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      cursor: pointer;
      padding: 0;
    }
    .maplibregl-popup-content {
      background: var(--surface) !important;
      color: var(--text) !important;
      border: 1px solid var(--line);
      border-radius: 14px !important;
      padding: 12px 14px !important;
      box-shadow: var(--shadow-sm) !important;
      font-family: inherit;
    }
    .maplibregl-popup-tip {
      border-top-color: var(--surface) !important;
      border-bottom-color: var(--surface) !important;
    }
    .popup-pico {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12.5px;
    }
    .popup-pico strong {
      font-size: 14px;
      font-weight: 800;
    }
    .popup-pico span {
      color: var(--muted);
    }
    .popup-acoes {
      display: flex;
      gap: 10px;
      margin-top: 4px;
    }
    .popup-link-acao {
      color: var(--accent);
      font-weight: 750;
    }
    .popup-link-acao:hover {
      text-decoration: underline;
    }
    .secao-uf {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .cabecalho-uf {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      border-bottom: 1px solid var(--line);
      padding-bottom: 6px;
    }
    .cabecalho-uf h2 {
      font-size: 20px;
      font-weight: 850;
    }
    .cabecalho-uf span {
      font-size: 12.5px;
      color: var(--muted);
    }
    .grade-picos {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .card-pico-vitrine {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px;
      border-radius: var(--radius-md);
      background: var(--surface);
      border: 1px solid var(--line);
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    .card-pico-vitrine:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    .thumb-pico-vitrine {
      width: 76px;
      height: 76px;
      border-radius: 12px;
      object-fit: cover;
      flex-shrink: 0;
      background: var(--bg-soft);
    }
    .info-pico-vitrine {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .info-pico-vitrine strong {
      font-size: 15.5px;
      font-weight: 800;
    }
    .local-pico-vitrine {
      font-size: 12.5px;
      color: var(--sage-deep);
      font-weight: 700;
    }
    .metricas-pico-vitrine {
      display: flex;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      margin-top: 2px;
    }
    .estado-vazio {
      padding: 32px;
      text-align: center;
      color: var(--muted);
    }
    @media (min-width: 820px) {
      .hero-vitrine {
        grid-template-columns: 1.3fr 1fr;
        align-items: center;
        padding: 30px 34px;
      }
      .grade-picos {
        grid-template-columns: repeat(2, 1fr);
      }
      .mapa-vitrine {
        height: 420px;
      }
    }
  </style>
</head>
<body>
  ${renderizarCabecalhoSite(true)}
  <main class="vitrine-main">
    <section class="hero-vitrine">
      <div>
        <h1>Croquis de Escalada no Brasil</h1>
        <p>Explore picos, setores e vias catalogados pela comunidade. Para fotos das paredes com linhas traçadas, betas e GPS 100% offline na rocha, baixe gratuitamente o aplicativo Aresta Climb.</p>
      </div>
      <div>
        ${renderizarBotoesLojas()}
      </div>
    </section>

    <section class="barra-pesquisa-wrap" aria-label="Pesquisar no catálogo">
      <input id="campoBuscaVitrine" class="campo-busca" type="search" placeholder="Buscar pico, cidade, setor, via ou boulder (ex: Cipó, Deslize, 7a)..." autocomplete="off">
      <ul id="resultadosBuscaInstantanea" class="dropdown-busca" aria-live="polite"></ul>
      ${chipsUfHtml}
    </section>

    ${blocoMapaHtml}

    <div id="diretorioEstados">
      ${conteudoPrincipalHtml}
    </div>
  </main>
  ${renderizarRodapeSite()}
  <script>
    (function () {${SCRIPT_ALTERNANCIA_TEMA}
      function normalizar(txt) {
        return (txt || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
      }
      var campo = document.getElementById("campoBuscaVitrine");
      var listaDropdown = document.getElementById("resultadosBuscaInstantanea");
      var cacheBusca = null;
      var carregandoBusca = false;
      var ufAtiva = "";

      function esc(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }

      function aplicarFiltroCards(termoNorm) {
        var secoes = document.querySelectorAll("[data-secao-uf]");
        for (var i = 0; i < secoes.length; i++) {
          var sec = secoes[i];
          var ufSec = sec.getAttribute("data-secao-uf") || "";
          if (ufAtiva && ufSec !== ufAtiva) {
            sec.style.display = "none";
            continue;
          }
          var cards = sec.querySelectorAll(".card-pico-vitrine");
          var visiveis = 0;
          for (var j = 0; j < cards.length; j++) {
            var alvo = normalizar(cards[j].getAttribute("data-busca") || "");
            var bate = !termoNorm || alvo.indexOf(termoNorm) !== -1;
            cards[j].style.display = bate ? "" : "none";
            if (bate) visiveis++;
          }
          sec.style.display = visiveis > 0 ? "" : "none";
        }
      }

      function renderizarDropdown(termoNorm) {
        if (!listaDropdown) return;
        if (!cacheBusca || termoNorm.length < 2) {
          listaDropdown.classList.remove("visivel");
          listaDropdown.innerHTML = "";
          return;
        }
        var achados = [];
        for (var i = 0; i < cacheBusca.length && achados.length < 25; i++) {
          var it = cacheBusca[i];
          if (it._n.indexOf(termoNorm) !== -1) achados.push(it);
        }
        if (achados.length === 0) {
          listaDropdown.innerHTML = '<li class="item-resultado-busca"><div class="res-info"><span>Nenhuma via, setor ou pico encontrado.</span></div></li>';
          listaDropdown.classList.add("visivel");
          return;
        }
        var html = "";
        for (var k = 0; k < achados.length; k++) {
          var r = achados[k];
          var sub = r.tipo === "croqui" ? (r.localizacao || "Croqui") : (r.croqui_nome + (r.localizacao ? " • " + r.localizacao : ""));
          var badge = r.grau ? r.grau : r.tipo;
          html += '<li><a class="item-resultado-busca" href="/croquis/' + esc(r.uid) + '/' + esc(r.slug) + '"><div class="res-info"><strong>' + esc(r.nome) + '</strong><span>' + esc(sub) + '</span></div><span class="res-badge">' + esc(badge) + '</span></a></li>';
        }
        listaDropdown.innerHTML = html;
        listaDropdown.classList.add("visivel");
      }

      function garantirIndiceBusca() {
        if (cacheBusca || carregandoBusca) return;
        carregandoBusca = true;
        fetch("/croquis/busca.json")
          .then(function (r) { return r.ok ? r.json() : []; })
          .then(function (dados) {
            cacheBusca = (dados || []).map(function (d) {
              d._n = normalizar([d.nome, d.grau, d.modalidade, d.croqui_nome, d.localizacao].join(" "));
              return d;
            });
            if (campo && campo.value) {
              renderizarDropdown(normalizar(campo.value.trim()));
            }
          })
          .catch(function () { carregandoBusca = false; });
      }

      if (campo) {
        campo.addEventListener("focus", garantirIndiceBusca);
        campo.addEventListener("input", function () {
          garantirIndiceBusca();
          var t = normalizar(campo.value.trim());
          aplicarFiltroCards(t);
          renderizarDropdown(t);
        });
      }

      var botoesUf = document.querySelectorAll("[data-uf-filtro]");
      for (var b = 0; b < botoesUf.length; b++) {
        botoesUf[b].addEventListener("click", function (ev) {
          var btn = ev.currentTarget;
          ufAtiva = btn.getAttribute("data-uf-filtro") || "";
          for (var x = 0; x < botoesUf.length; x++) botoesUf[x].classList.remove("ativo");
          btn.classList.add("ativo");
          aplicarFiltroCards(normalizar(campo ? campo.value.trim() : ""));
        });
      }

      var pinos = ${scriptMapaJson};
      var instanciaMapa = null;
      function obterEstiloMapa() {
        var tema = document.documentElement.getAttribute("data-theme") || "dark";
        return tema === "dark"
          ? "https://tiles.openfreemap.org/styles/dark"
          : "https://tiles.openfreemap.org/styles/liberty";
      }
      function iniciarMapa() {
        var elMapa = document.getElementById("mapaVitrineCroquis");
        if (!elMapa || !window.maplibregl || pinos.length === 0) return;
        var mapa = new window.maplibregl.Map({
          container: elMapa,
          style: obterEstiloMapa(),
          center: [-44.0, -19.9],
          zoom: 5,
          attributionControl: true
        });
        instanciaMapa = mapa;
        mapa.scrollZoom.disable();
        mapa.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), "top-left");
        var limites = new window.maplibregl.LngLatBounds();
        for (var i = 0; i < pinos.length; i++) {
          var p = pinos[i];
          limites.extend([p.lng, p.lat]);
          var elPino = document.createElement("button");
          elPino.type = "button";
          elPino.className = "pino-mapa-aresta";
          elPino.setAttribute("aria-label", p.nome);
          var linkMaps = p.urlMaps ? '<a class="popup-link-acao" href="' + esc(p.urlMaps) + '" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>' : '';
          var popup = new window.maplibregl.Popup({ offset: 12, closeButton: false, maxWidth: "260px" })
            .setHTML('<div class="popup-pico"><strong>' + esc(p.nome) + '</strong><span>' + esc(p.local || "") + ' · ' + p.setores + ' setores · ' + p.escaladas + ' escaladas</span><div class="popup-acoes"><a class="popup-link-acao" href="' + esc(p.href) + '">Ver guia →</a>' + linkMaps + '</div></div>');
          new window.maplibregl.Marker({ element: elPino })
            .setLngLat([p.lng, p.lat])
            .setPopup(popup)
            .addTo(mapa);
        }
        if (pinos.length === 1) {
          mapa.jumpTo({ center: [pinos[0].lng, pinos[0].lat], zoom: 11 });
        } else {
          mapa.fitBounds(limites, { padding: 42, maxZoom: 12, duration: 0 });
        }
      }
      var btnTemaMapa = document.getElementById("themeToggle");
      if (btnTemaMapa) {
        btnTemaMapa.addEventListener("click", function () {
          if (instanciaMapa) instanciaMapa.setStyle(obterEstiloMapa());
        });
      }
      if (document.readyState === "complete") {
        iniciarMapa();
      } else {
        window.addEventListener("load", iniciarMapa);
      }
    })();
  </script>
</body>
</html>`;
}
