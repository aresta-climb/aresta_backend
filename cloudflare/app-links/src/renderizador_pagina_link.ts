// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  MetadadosRotaLink,
  ResumoEntidadeLink,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";

const URL_CDN_THUMBNAILS = "https://serving.arestaclimb.com/v4/thumbnails";
const URL_IMAGEM_PADRAO_OG = "https://arestaclimb.com/og.png";
const URL_LOGO_APP = "https://arestaclimb.com/assets/logo_app.png";
const URL_SITE_PRINCIPAL = "https://arestaclimb.com";
const URL_LOJA_IOS = "https://apps.apple.com/app/id6776467893";
const URL_LOJA_ANDROID =
  "https://play.google.com/store/apps/details?id=app.escalada.croquis";
const URL_SCRIPT_UMAMI = "https://analytics.arestaclimb.com/script.js";
const ID_WEBSITE_UMAMI = "3ba79f5e-e49f-42d4-9283-586976189124";

const ROTULO_TIPO: Record<ResumoEntidadeLink["tipo"], string> = {
  croqui: "Croqui de Escalada",
  grupo: "Grupo de Setores",
  setor: "Setor de Escalada",
  escalada: "Via de Escalada",
};

const SVG_APPLE_STORE =
  '<svg viewBox="0 0 384 512" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';

const SVG_GOOGLE_PLAY =
  '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/></svg>';

const ESTILOS_BASE_DESIGN_SYSTEM = `
    :root {
      --bg: #f4f1e9;
      --bg-soft: #ece7dd;
      --surface: #faf8f2;
      --surface-2: #e6e0d5;
      --text: #1d1c19;
      --muted: #6c675f;
      --line: #d6cfc2;
      --accent: #b53e29;
      --accent-2: #9d2e1b;
      --sage: #90a989;
      --sage-deep: #596e55;
      --shadow: 0 24px 70px rgba(57, 43, 33, 0.14);
      --shadow-sm: 0 8px 24px rgba(57, 43, 33, 0.08);
      --topo: rgba(109, 92, 72, 0.11);
      --radius-sm: 12px;
      --radius-md: 18px;
      --radius-lg: 28px;
      --radius-full: 9999px;
    }
    html[data-theme="dark"] {
      --bg: #11120f;
      --bg-soft: #171813;
      --surface: #1c1d18;
      --surface-2: #24251f;
      --text: #f3f0e8;
      --muted: #aaa69c;
      --line: #35362e;
      --accent: #cf563d;
      --accent-2: #b53e29;
      --sage: #90a989;
      --sage-deep: #8ca684;
      --shadow: 0 28px 90px rgba(0, 0, 0, 0.45);
      --shadow-sm: 0 8px 24px rgba(0, 0, 0, 0.28);
      --topo: rgba(144, 169, 137, 0.07);
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html {
      color-scheme: light dark;
      scroll-behavior: smooth;
    }
    body {
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      background-image:
        radial-gradient(circle at 90% 10%, var(--topo), transparent 30%),
        radial-gradient(circle at 10% 80%, var(--topo), transparent 30%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      background: color-mix(in srgb, var(--bg) 85%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
    }
    .nav {
      max-width: 960px;
      margin: 0 auto;
      height: 64px;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 850;
      letter-spacing: -0.04em;
      font-size: 1.05rem;
      color: var(--text);
    }
    .logo-img {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: block;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .theme-toggle {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      display: grid;
      place-items: center;
      font-size: 1.05rem;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .theme-toggle:hover {
      transform: scale(1.05);
      border-color: var(--accent);
    }
    .btn-site {
      padding: 8px 16px;
      border-radius: var(--radius-full);
      background: var(--surface);
      border: 1px solid var(--line);
      color: var(--text);
      font-size: 0.84rem;
      font-weight: 650;
      transition: border-color 0.15s ease;
    }
    .btn-site:hover {
      border-color: var(--accent);
    }
    .store-badge-group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      width: 100%;
    }
    .store-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 11px 14px;
      border-radius: 14px;
      background: #0d0e0b;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.16);
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .store-badge:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
    }
    .store-badge svg {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      fill: currentColor;
    }
    .store-badge-text {
      display: flex;
      flex-direction: column;
      line-height: 1.15;
      text-align: left;
    }
    .store-badge-text small {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.78;
    }
    .store-badge-text strong {
      font-size: 13px;
      font-weight: 700;
    }
    .site-footer {
      border-top: 1px solid var(--line);
      padding: 20px;
      color: var(--muted);
      font-size: 0.82rem;
    }
    .footer-inner {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .footer-links {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
    }
    .footer-links a:hover {
      color: var(--accent);
      text-decoration: underline;
    }
`;

const SCRIPT_INICIALIZACAO_TEMA = `<script>try{var t=localStorage.getItem('aresta-theme')||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>`;

const SCRIPT_ALTERNANCIA_TEMA = `
      var btnTema = document.getElementById("themeToggle");
      if (btnTema) {
        btnTema.addEventListener("click", function () {
          var atual = document.documentElement.getAttribute("data-theme") || "dark";
          var proximo = atual === "dark" ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", proximo);
          try { localStorage.setItem("aresta-theme", proximo); } catch (e) {}
        });
      }`;

/**
 * Escapa caracteres especiais HTML (`&`, `<`, `>`, `"`, `'`) para evitar
 * vulnerabilidades de Cross-Site Scripting (XSS) ao interpolar nomes do catálogo.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formata a modalidade de escalada com a primeira letra maiúscula (ex.: `boulder` -> `Boulder`).
 */
export function formatarModalidade(modalidade: string | null): string | null {
  if (!modalidade) {
    return null;
  }
  const limpo = modalidade.trim();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
}

/**
 * Remove prefixos redundantes (`Setor ` ou `Grupo `) do início do nome para evitar
 * repetições como `Setor: Setor Tramontina` ou `Grupo: Grupo Sherpa`.
 */
export function removerPrefixoRedundante(
  nome: string,
  prefixo: "Setor" | "Grupo"
): string {
  return nome.trim().replace(new RegExp(`^${prefixo}\\s+`, "i"), "");
}

/**
 * Resolve o rótulo semântico principal da entidade, distinguindo `Boulder` e `Highline`
 * de `Via de Escalada` quando a entidade é do tipo `escalada`.
 */
export function obterRotuloTipoEntidade(entidade: ResumoEntidadeLink): string {
  const modalidadeMinuscula = entidade.escalada_tipo?.trim().toLowerCase();
  if (entidade.tipo === "escalada" && modalidadeMinuscula === "boulder") {
    return "Boulder";
  }
  if (entidade.tipo === "escalada" && modalidadeMinuscula === "highline") {
    return "Highline";
  }
  return ROTULO_TIPO[entidade.tipo];
}

function formatarLocalizacao(
  cidade: string | null,
  estado: string | null
): string | null {
  if (cidade && estado) {
    return `${cidade} - ${estado}`;
  }
  return cidade || estado || null;
}

function construirTituloOpenGraph(entidade: ResumoEntidadeLink): string {
  if (entidade.tipo === "croqui") {
    return `${entidade.nome} | Aresta Croquis de Escalada`;
  }
  if (entidade.tipo === "escalada" && entidade.escalada_grau) {
    return `${entidade.nome} (${entidade.escalada_grau}) — ${entidade.croqui_nome} | Aresta`;
  }
  return `${entidade.nome} — ${entidade.croqui_nome} | Aresta`;
}

function construirDescricaoOpenGraph(
  entidade: ResumoEntidadeLink,
  abrirMapa: boolean
): string {
  const partes: string[] = [obterRotuloTipoEntidade(entidade)];
  const modalidadeFormatada = formatarModalidade(entidade.escalada_tipo);

  if (modalidadeFormatada) {
    partes.push(`Modalidade: ${modalidadeFormatada}`);
  }
  if (entidade.setor_nome) {
    partes.push(
      `Setor: ${removerPrefixoRedundante(entidade.setor_nome, "Setor")}`
    );
  }
  if (entidade.grupo_nome) {
    partes.push(
      `Grupo: ${removerPrefixoRedundante(entidade.grupo_nome, "Grupo")}`
    );
  }
  if (entidade.tipo !== "croqui") {
    partes.push(`Croqui: ${entidade.croqui_nome}`);
  }

  const localizacao = formatarLocalizacao(entidade.cidade, entidade.estado);
  if (localizacao) {
    partes.push(`Local: ${localizacao}`);
  }

  if (abrirMapa) {
    partes.push("Mapa interativo");
  }

  return `${partes.join(" • ")}. Abra no aplicativo Aresta para visualizar croquis e rotas offline.`;
}

function renderizarBotoesLojas(): string {
  return `<div class="store-badge-group">
              <a class="store-badge" href="${URL_LOJA_IOS}" target="_blank" rel="noopener noreferrer" aria-label="Baixar na Apple App Store">
                ${SVG_APPLE_STORE}
                <span class="store-badge-text">
                  <small>Disponível na</small>
                  <strong>App Store</strong>
                </span>
              </a>
              <a class="store-badge" href="${URL_LOJA_ANDROID}" target="_blank" rel="noopener noreferrer" aria-label="Baixar no Google Play">
                ${SVG_GOOGLE_PLAY}
                <span class="store-badge-text">
                  <small>Disponível no</small>
                  <strong>Google Play</strong>
                </span>
              </a>
            </div>`;
}

function renderizarCabecalhoSite(): string {
  return `<header class="header">
    <div class="nav">
      <a href="${URL_SITE_PRINCIPAL}" class="logo" aria-label="Aresta Climb - Início">
        <img src="${URL_LOGO_APP}" alt="Aresta Climb Logo" class="logo-img" width="32" height="32">
        <span>ARESTA CLIMB</span>
      </a>
      <div class="nav-actions">
        <button class="theme-toggle" id="themeToggle" type="button" aria-label="Alternar tema claro e escuro">◐</button>
        <a href="${URL_SITE_PRINCIPAL}" class="btn-site">Conhecer o Aresta ↗</a>
      </div>
    </div>
  </header>`;
}

function renderizarRodapeSite(): string {
  return `<footer class="site-footer">
    <div class="footer-inner">
      <span>© 2026 Aresta Climb · Croquis de escalada 100% offline</span>
      <div class="footer-links">
        <a href="${URL_SITE_PRINCIPAL}">arestaclimb.com</a>
        <a href="${URL_LOJA_IOS}" target="_blank" rel="noopener noreferrer">App Store</a>
        <a href="${URL_LOJA_ANDROID}" target="_blank" rel="noopener noreferrer">Google Play</a>
      </div>
    </div>
  </footer>`;
}

/**
 * Renderiza a página HTML SSR de uma entidade compartilhada (`croqui`, `grupo`, `setor` ou `escalada`),
 * incluindo meta tags OpenGraph para preview rico em redes sociais, layout Mobile-First inspirado
 * na `PicoPage` do aplicativo (e Card de 2 Colunas no Desktop), botões clássicos das lojas com SVG
 * e script Umami para telemetria de campanha.
 */
export function renderizarPaginaEntidade(
  entidade: ResumoEntidadeLink,
  rota: MetadadosRotaLink
): string {
  const tituloOg = escaparHtml(construirTituloOpenGraph(entidade));
  const descricaoOg = escaparHtml(
    construirDescricaoOpenGraph(entidade, rota.abrir_mapa)
  );
  const imagemOg = entidade.id_slug
    ? `${URL_CDN_THUMBNAILS}/${encodeURIComponent(entidade.id_slug)}.webp`
    : URL_IMAGEM_PADRAO_OG;

  const sufixoCaminho = rota.prefixo
    ? `${rota.prefixo}/${rota.uid}`
    : rota.uid;
  const urlCanonico = `https://aresta.cc/${sufixoCaminho}`;
  const deepLinkApp = `aresta://aresta.cc/${sufixoCaminho}`;

  const localizacao = formatarLocalizacao(entidade.cidade, entidade.estado);
  const rotuloTipo = obterRotuloTipoEntidade(entidade);
  const modalidadeFormatada = formatarModalidade(entidade.escalada_tipo);
  const nomeSetorLimpo = entidade.setor_nome
    ? removerPrefixoRedundante(entidade.setor_nome, "Setor")
    : null;
  const nomeGrupoLimpo = entidade.grupo_nome
    ? removerPrefixoRedundante(entidade.grupo_nome, "Grupo")
    : null;

  const partesSubtitulo: string[] = [];
  if (localizacao) {
    partesSubtitulo.push(localizacao);
  }
  if (modalidadeFormatada) {
    partesSubtitulo.push(modalidadeFormatada);
  }
  if (entidade.escalada_grau) {
    partesSubtitulo.push(`Graduação ${entidade.escalada_grau}`);
  }
  if (partesSubtitulo.length === 0) {
    partesSubtitulo.push(rotuloTipo);
  }
  const subtituloResumo = escaparHtml(partesSubtitulo.join(" • "));

  const payloadTelemetriaJson = JSON.stringify({
    uid: entidade.uid,
    tipo: entidade.tipo,
    id_slug: entidade.id_slug,
    abrir_mapa: rota.abrir_mapa,
    origem_link: rota.origem_link,
    utm_source: rota.utm_source,
    utm_medium: rota.utm_medium,
  });

  const cardsContextoHtml: string[] = [];
  if (entidade.tipo !== "croqui") {
    cardsContextoHtml.push(
      `<li class="card-contexto">
              <span class="icone-contexto" aria-hidden="true">⛰</span>
              <div class="texto-contexto">
                <strong>Croqui: ${escaparHtml(entidade.croqui_nome)}</strong>
                <span>Guia completo disponível para download offline</span>
              </div>
            </li>`
    );
  }
  if (nomeGrupoLimpo) {
    cardsContextoHtml.push(
      `<li class="card-contexto">
              <span class="icone-contexto" aria-hidden="true">🧭</span>
              <div class="texto-contexto">
                <strong>Grupo: ${escaparHtml(nomeGrupoLimpo)}</strong>
                <span>Agrupamento de setores do pico</span>
              </div>
            </li>`
    );
  }
  if (nomeSetorLimpo) {
    cardsContextoHtml.push(
      `<li class="card-contexto">
              <span class="icone-contexto" aria-hidden="true">📍</span>
              <div class="texto-contexto">
                <strong>Setor: ${escaparHtml(nomeSetorLimpo)}</strong>
                <span>Setor de escalada e croqui de parede</span>
              </div>
            </li>`
    );
  }
  if (entidade.escalada_grau) {
    cardsContextoHtml.push(
      `<li class="card-contexto">
              <span class="icone-contexto badge-grau" aria-hidden="true">${escaparHtml(entidade.escalada_grau)}</span>
              <div class="texto-contexto">
                <strong>Graduação: ${escaparHtml(entidade.escalada_grau)}</strong>
                <span>Grau técnico registrado no guia</span>
              </div>
            </li>`
    );
  }
  if (modalidadeFormatada) {
    cardsContextoHtml.push(
      `<li class="card-contexto">
              <span class="icone-contexto" aria-hidden="true">🧗</span>
              <div class="texto-contexto">
                <strong>Modalidade: ${escaparHtml(modalidadeFormatada)}</strong>
                <span>Estilo e proteções detalhados no aplicativo</span>
              </div>
            </li>`
    );
  }
  if (localizacao) {
    cardsContextoHtml.push(
      `<li class="card-contexto">
              <span class="icone-contexto" aria-hidden="true">🗺</span>
              <div class="texto-contexto">
                <strong>Localização: ${escaparHtml(localizacao)}</strong>
                <span>Rotas de acesso e aproximação no aplicativo</span>
              </div>
            </li>`
    );
  }

  return `<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  ${SCRIPT_INICIALIZACAO_TEMA}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="apple-itunes-app" content="app-id=6776467893, app-argument=${escaparHtml(urlCanonico)}">
  <link rel="icon" type="image/svg+xml" href="https://arestaclimb.com/favicon.svg">
  <title>${tituloOg}</title>
  <meta name="description" content="${descricaoOg}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Aresta Croquis de Escalada">
  <meta property="og:title" content="${tituloOg}">
  <meta property="og:description" content="${descricaoOg}">
  <meta property="og:image" content="${escaparHtml(imagemOg)}">
  <meta property="og:url" content="${escaparHtml(urlCanonico)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${tituloOg}">
  <meta name="twitter:description" content="${descricaoOg}">
  <meta name="twitter:image" content="${escaparHtml(imagemOg)}">
  <script defer src="${URL_SCRIPT_UMAMI}" data-website-id="${ID_WEBSITE_UMAMI}"></script>
  <style>${ESTILOS_BASE_DESIGN_SYSTEM}
    .pagina-main {
      flex: 1;
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .cartao-entidade {
      width: 100%;
      max-width: 540px;
      display: flex;
      flex-direction: column;
    }
    .hero-midia {
      width: 100%;
      aspect-ratio: 1 / 1;
      position: relative;
      overflow: hidden;
      background: var(--bg-soft);
    }
    .miniatura {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .hero-gradiente {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        to bottom,
        transparent 52%,
        color-mix(in srgb, var(--bg) 82%, transparent) 84%,
        var(--bg) 100%
      );
      pointer-events: none;
    }
    .conteudo-entidade {
      position: relative;
      z-index: 2;
      margin-top: -54px;
      padding: 0 20px 36px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .etiqueta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .etiqueta::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
    }
    h1 {
      font-size: clamp(26px, 6vw, 34px);
      line-height: 1.1;
      font-weight: 900;
      letter-spacing: -0.03em;
      color: var(--text);
    }
    .subtitulo-entidade {
      font-size: 13px;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--sage-deep);
    }
    .banner-app {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 18px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .banner-app-topo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      font-weight: 850;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .banner-app-desc {
      font-size: 13.5px;
      color: var(--muted);
      line-height: 1.45;
    }
    .acao-abrir-app-mobile {
      padding-top: 4px;
      text-align: center;
      font-size: 13px;
      color: var(--muted);
    }
    .link-abrir-app {
      color: var(--accent);
      font-weight: 700;
      margin-left: 4px;
    }
    .link-abrir-app:hover {
      text-decoration: underline;
    }
    .lista-cards-contexto {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-contexto {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .icone-contexto {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--accent);
      display: grid;
      place-items: center;
      font-size: 18px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .icone-contexto.badge-grau {
      font-size: 14px;
      border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    }
    .texto-contexto {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .texto-contexto strong {
      font-size: 14.5px;
      font-weight: 750;
      color: var(--text);
    }
    .texto-contexto span {
      font-size: 12.5px;
      color: var(--muted);
    }
    @media (min-width: 820px) {
      .pagina-main {
        align-items: center;
        padding: 40px 24px;
      }
      .cartao-entidade {
        max-width: 920px;
        display: grid;
        grid-template-columns: 400px 1fr;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow);
        overflow: hidden;
        align-items: center;
      }
      .hero-midia {
        height: 100%;
        min-height: 400px;
      }
      .hero-gradiente {
        display: none;
      }
      .conteudo-entidade {
        margin-top: 0;
        padding: 32px 36px;
      }
      .banner-app, .card-contexto {
        background: var(--bg);
      }
      .acao-abrir-app-mobile {
        display: none;
      }
    }
  </style>
</head>
<body>
  ${renderizarCabecalhoSite()}
  <main class="pagina-main">
    <article class="cartao-entidade">
      <div class="hero-midia">
        <img class="miniatura" src="${escaparHtml(imagemOg)}" alt="${tituloOg}">
        <div class="hero-gradiente"></div>
      </div>
      <div class="conteudo-entidade">
        <div class="cabecalho-entidade">
          <div class="etiqueta">${escaparHtml(rotuloTipo)}${rota.abrir_mapa ? " • Mapa interativo" : ""}</div>
          <h1>${escaparHtml(entidade.nome)}${entidade.escalada_grau ? ` (${escaparHtml(entidade.escalada_grau)})` : ""}</h1>
        </div>
        <p class="subtitulo-entidade">${subtituloResumo}</p>
        <section class="banner-app" aria-label="Download do aplicativo Aresta Climb">
          <div class="banner-app-topo">
            <span aria-hidden="true">☁</span>
            <span>CROQUI OFFLINE NO APLICATIVO</span>
          </div>
          <p class="banner-app-desc">
            Salve o guia completo no celular para consultar fotos da parede, linhas das vias e mapas 100% offline na rocha.
          </p>
          ${renderizarBotoesLojas()}
          <div class="acao-abrir-app-mobile">
            Já tem o Aresta instalado?
            <a class="link-abrir-app" href="${escaparHtml(deepLinkApp)}">Abrir no aplicativo →</a>
          </div>
        </section>
        <ul class="lista-cards-contexto">
          ${cardsContextoHtml.join("\n          ")}
        </ul>
      </div>
    </article>
  </main>
  ${renderizarRodapeSite()}
  <script>
    (function () {${SCRIPT_ALTERNANCIA_TEMA}
      var dadosBase = ${payloadTelemetriaJson};
      var params = new URLSearchParams(window.location.search);
      if (params.get("utm_source")) {
        dadosBase.utm_source = params.get("utm_source");
      } else if (dadosBase.utm_source) {
        params.set("utm_source", dadosBase.utm_source);
      }
      if (params.get("utm_medium")) {
        dadosBase.utm_medium = params.get("utm_medium");
      } else if (dadosBase.utm_medium) {
        params.set("utm_medium", dadosBase.utm_medium);
      }
      var novaQuery = params.toString();
      if (novaQuery && window.history && typeof window.history.replaceState === "function") {
        window.history.replaceState(null, "", window.location.pathname + "?" + novaQuery);
      }
      function registrarTelemetria() {
        if (window.umami && typeof window.umami.track === "function") {
          window.umami.track("app-link-acesso", dadosBase);
        }
      }
      if (document.readyState === "complete") {
        registrarTelemetria();
      } else {
        window.addEventListener("load", registrarTelemetria);
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Renderiza uma página HTML amigável para status `404 Not Found` quando a rota
 * ou o UID solicitado não existir no catálogo, seguindo o mesmo Design System Light/Dark.
 */
export function renderizarPaginaNaoEncontrada(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  ${SCRIPT_INICIALIZACAO_TEMA}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="https://arestaclimb.com/favicon.svg">
  <title>Link não encontrado | Aresta Croquis de Escalada</title>
  <meta name="robots" content="noindex">
  <style>${ESTILOS_BASE_DESIGN_SYSTEM}
    .pagina-404 {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
    }
    .cartao-404 {
      max-width: 480px;
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 36px 28px;
      text-align: center;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .badge-erro {
      display: inline-block;
      padding: 5px 12px;
      border-radius: var(--radius-full);
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      font-size: 26px;
      font-weight: 850;
      letter-spacing: -0.03em;
    }
    p {
      color: var(--muted);
      font-size: 15px;
      line-height: 1.55;
      margin-bottom: 6px;
    }
    .btn-primario {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 13px 20px;
      border-radius: var(--radius-full);
      background: var(--accent);
      color: #ffffff;
      font-weight: 700;
      font-size: 15px;
      transition: background-color 0.15s ease;
    }
    .btn-primario:hover {
      background: var(--accent-2);
    }
  </style>
</head>
<body>
  ${renderizarCabecalhoSite()}
  <main class="pagina-404">
    <section class="cartao-404">
      <span class="badge-erro">Erro 404</span>
      <h1>Link não encontrado</h1>
      <p>O croqui, setor ou via de escalada solicitado não foi encontrado ou o endereço está incorreto.</p>
      <a class="btn-primario" href="${URL_SITE_PRINCIPAL}">Ir para arestaclimb.com</a>
      ${renderizarBotoesLojas()}
    </section>
  </main>
  ${renderizarRodapeSite()}
  <script>
    (function () {${SCRIPT_ALTERNANCIA_TEMA}
    })();
  </script>
</body>
</html>`;
}
