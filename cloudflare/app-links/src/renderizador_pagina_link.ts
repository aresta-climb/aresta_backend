// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  MetadadosRotaLink,
  ResumoEntidadeLink,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";

const URL_CDN_THUMBNAILS = "https://serving.arestaclimb.com/v4/thumbnails";
const URL_IMAGEM_PADRAO_OG = "https://arestaclimb.com/og.png";
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
  const partes: string[] = [ROTULO_TIPO[entidade.tipo]];

  if (entidade.escalada_tipo) {
    partes.push(`Modalidade: ${entidade.escalada_tipo}`);
  }
  if (entidade.setor_nome) {
    partes.push(`Setor: ${entidade.setor_nome}`);
  }
  if (entidade.grupo_nome) {
    partes.push(`Grupo: ${entidade.grupo_nome}`);
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

/**
 * Renderiza a página HTML SSR de uma entidade compartilhada (`croqui`, `grupo`, `setor` ou `escalada`),
 * incluindo meta tags OpenGraph para preview rico em redes sociais, cartão informativo com botões
 * para abrir o aplicativo nativo ou baixá-lo nas lojas, e script Umami para telemetria de campanha.
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
  const rotuloTipo = ROTULO_TIPO[entidade.tipo];

  const payloadTelemetriaJson = JSON.stringify({
    uid: entidade.uid,
    tipo: entidade.tipo,
    id_slug: entidade.id_slug,
    abrir_mapa: rota.abrir_mapa,
    origem_link: rota.origem_link,
    utm_source: rota.utm_source,
    utm_medium: rota.utm_medium,
  });

  const detalhesExtrasHtml: string[] = [];
  if (entidade.tipo !== "croqui") {
    detalhesExtrasHtml.push(
      `<li><strong>Croqui:</strong> ${escaparHtml(entidade.croqui_nome)}</li>`
    );
  }
  if (entidade.grupo_nome) {
    detalhesExtrasHtml.push(
      `<li><strong>Grupo:</strong> ${escaparHtml(entidade.grupo_nome)}</li>`
    );
  }
  if (entidade.setor_nome) {
    detalhesExtrasHtml.push(
      `<li><strong>Setor:</strong> ${escaparHtml(entidade.setor_nome)}</li>`
    );
  }
  if (entidade.escalada_grau) {
    detalhesExtrasHtml.push(
      `<li><strong>Graduação:</strong> ${escaparHtml(entidade.escalada_grau)}</li>`
    );
  }
  if (entidade.escalada_tipo) {
    detalhesExtrasHtml.push(
      `<li><strong>Modalidade:</strong> ${escaparHtml(entidade.escalada_tipo)}</li>`
    );
  }
  if (localizacao) {
    detalhesExtrasHtml.push(
      `<li><strong>Localização:</strong> ${escaparHtml(localizacao)}</li>`
    );
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
  <style>
    :root {
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .cartao {
      max-width: 460px;
      width: 100%;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .miniatura {
      width: 100%;
      height: 220px;
      object-fit: cover;
      background: #0f172a;
      display: block;
    }
    .conteudo {
      padding: 24px;
    }
    .etiqueta {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #f59e0b;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 24px;
      line-height: 1.25;
      margin-bottom: 12px;
      color: #ffffff;
    }
    .detalhes {
      list-style: none;
      margin-bottom: 24px;
      color: #cbd5e1;
      font-size: 15px;
      line-height: 1.6;
    }
    .botoes {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .botao-primario {
      display: block;
      text-align: center;
      background: #f59e0b;
      color: #0f172a;
      font-weight: 700;
      text-decoration: none;
      padding: 14px 20px;
      border-radius: 10px;
      font-size: 16px;
    }
    .lojas {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .botao-loja {
      display: block;
      text-align: center;
      background: #334155;
      color: #f8fafc;
      text-decoration: none;
      padding: 12px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
    }
    .rodape {
      margin-top: 18px;
      text-align: center;
      font-size: 13px;
    }
    .rodape a {
      color: #94a3b8;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main class="cartao">
    <img class="miniatura" src="${escaparHtml(imagemOg)}" alt="${tituloOg}">
    <div class="conteudo">
      <span class="etiqueta">${escaparHtml(rotuloTipo)}${rota.abrir_mapa ? " • Mapa interativo" : ""}</span>
      <h1>${escaparHtml(entidade.nome)}${entidade.escalada_grau ? ` (${escaparHtml(entidade.escalada_grau)})` : ""}</h1>
      <ul class="detalhes">
        ${detalhesExtrasHtml.join("\n        ")}
      </ul>
      <div class="botoes">
        <a class="botao-primario" href="${escaparHtml(deepLinkApp)}">Abrir no App Aresta</a>
        <div class="lojas">
          <a class="botao-loja" href="${URL_LOJA_ANDROID}" rel="noopener noreferrer">Google Play</a>
          <a class="botao-loja" href="${URL_LOJA_IOS}" rel="noopener noreferrer">App Store</a>
        </div>
      </div>
      <div class="rodape">
        <a href="${URL_SITE_PRINCIPAL}">Conhecer o projeto Aresta Climb</a>
      </div>
    </div>
  </main>
  <script>
    (function () {
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
 * ou o UID solicitado não existir no catálogo.
 */
export function renderizarPaginaNaoEncontrada(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Link não encontrado | Aresta Croquis de Escalada</title>
  <meta name="robots" content="noindex">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      margin: 0;
    }
    .cartao {
      max-width: 420px;
      width: 100%;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 28px;
      text-align: center;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 12px;
    }
    p {
      color: #cbd5e1;
      font-size: 15px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .botoes {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    a {
      display: block;
      padding: 12px 16px;
      border-radius: 10px;
      font-weight: 600;
      text-decoration: none;
    }
    .primario {
      background: #f59e0b;
      color: #0f172a;
    }
    .secundario {
      background: #334155;
      color: #f8fafc;
    }
  </style>
</head>
<body>
  <main class="cartao">
    <h1>Link não encontrado</h1>
    <p>O croqui, setor ou via de escalada solicitado não foi encontrado ou o endereço está incorreto.</p>
    <div class="botoes">
      <a class="primario" href="${URL_SITE_PRINCIPAL}">Ir para arestaclimb.com</a>
      <a class="secundario" href="${URL_LOJA_ANDROID}" rel="noopener noreferrer">Baixar no Google Play</a>
      <a class="secundario" href="${URL_LOJA_IOS}" rel="noopener noreferrer">Baixar na App Store</a>
    </div>
  </main>
</body>
</html>`;
}
