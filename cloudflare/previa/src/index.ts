// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import {
  MetadadosSessaoPrevia,
  RespostaSaudePrevia,
  RespostaSessaoPrevia,
  ROTA_CONECTAR_WEBSOCKET_PREVIA,
  ROTA_CRIAR_SESSAO_PREVIA,
  ROTA_VERIFICAR_SAUDE_PREVIA,
  URL_SERVIDOR_PADRAO,
} from "../../../aresta_api/openapi/generated/ts/previa.ts";
import { GerenciadorSessao } from "./gerenciador_sessao.ts";
import { MensagemEvento, RequisicaoProxy, RespostaProxy, MetadadosEditor } from "./tipos.ts";
import { validarTokenJwt, extrairJwtDeCabecalho } from "./validador_jwt.ts";
import { registrarInicioSessao, registrarFimSessao, obterQuantidadeSessoesAtivasBanco } from "./cliente_auditoria_supabase.ts";
import {
  InterfaceRelatorSentry,
  relatarErroSentry,
} from "../../../supabase/functions/compartilhado/relator_sentry.ts";
import * as Sentry from "@sentry/cloudflare";

export const gerenciador = new GerenciadorSessao();

// Configura callback automático de auditoria para encerramento de sessões
gerenciador.aoEncerrarSessao = (sessao, motivo, duracaoSegundos) => {
  registrarFimSessao(sessao.idAuditoria || sessao.codigo, {
    encerradoEm: new Date().toISOString(),
    duracaoSegundos,
    motivoEncerramento: motivo,
  });
};

export interface ContextoWorker {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SENTRY_DSN?: string;
  relatorSentry?: InterfaceRelatorSentry;
  SESSAO_DO?: any;
  validarJwt?: typeof validarTokenJwt;
  gerenciadorPersonalizado?: GerenciadorSessao;
  executarFetchServing?: typeof fetch;
}

const URL_SITE_PRINCIPAL = "https://arestaclimb.com";
const URL_LOGO_APP = "https://arestaclimb.com/assets/logo_app.png";
const URL_LOJA_IOS = "https://apps.apple.com/app/id6776467893";
const URL_LOJA_ANDROID = "https://play.google.com/store/apps/details?id=app.escalada.croquis";

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
    (function () {
      var btnTema = document.getElementById("themeToggle");
      if (btnTema) {
        btnTema.addEventListener("click", function () {
          var atual = document.documentElement.getAttribute("data-theme") || "dark";
          var proximo = atual === "dark" ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", proximo);
          try { localStorage.setItem("aresta-theme", proximo); } catch (e) {}
        });
      }
    })();`;

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

function renderizarPaginaResumoNaoEncontrado(numeroPr: number): string {
  return `<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  ${SCRIPT_INICIALIZACAO_TEMA}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="https://arestaclimb.com/favicon.svg">
  <title>Resumo da PR #${numeroPr} não encontrado | Aresta Climb</title>
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
      font-size: 24px;
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
      <h1>Resumo da PR #${numeroPr} não encontrado (404)</h1>
      <p>Esta Pull Request já foi encerrada ou os artefatos de prévia não estão mais disponíveis no armazenamento.</p>
      <a class="btn-primario" href="${URL_SITE_PRINCIPAL}">Ir para arestaclimb.com</a>
      ${renderizarBotoesLojas()}
    </section>
  </main>
  ${renderizarRodapeSite()}
  <script>${SCRIPT_ALTERNANCIA_TEMA}</script>
</body>
</html>`;
}

function renderizarPaginaPrevia(codigoFormatado: string, numeroPr: number | null): string {
  const urlPrevia = `https://previa.arestaclimb.com/${codigoFormatado}`;
  const urlQrCodePr = numeroPr !== null ? `https://serving.arestaclimb.com/pr/${numeroPr}/qrcode.svg` : null;

  return `<!DOCTYPE html>
<html lang="pt-BR" data-theme="dark">
<head>
  ${SCRIPT_INICIALIZACAO_TEMA}
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="https://arestaclimb.com/favicon.svg">
  <title>Aresta Climb - Prévia do Croqui (${codigoFormatado})</title>
  <style>${ESTILOS_BASE_DESIGN_SYSTEM}
    .pagina-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
    }
    .card {
      background-color: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 36px 28px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
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
    }
    .etiqueta::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
    }
    h1 {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -0.03em;
      color: var(--text);
    }
    p {
      color: var(--muted);
      font-size: 14.5px;
      line-height: 1.5;
    }
    .codigo-box {
      width: 100%;
      background-color: var(--bg-soft);
      border: 1px dashed var(--accent);
      border-radius: var(--radius-md);
      padding: 16px;
    }
    .codigo-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--accent);
      margin-bottom: 4px;
      font-weight: 700;
    }
    .codigo-valor {
      font-size: 28px;
      font-family: monospace;
      font-weight: 800;
      letter-spacing: 2px;
      color: var(--text);
    }
    .qr-container {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      background: #ffffff;
      padding: 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
    }
    .qr-container img {
      width: 148px;
      height: 148px;
      display: block;
    }
    .btn-abrir {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      background-color: var(--accent);
      color: #ffffff;
      text-decoration: none;
      font-weight: 700;
      font-size: 15.5px;
      padding: 14px 20px;
      border-radius: var(--radius-full);
      transition: background-color 0.15s ease;
    }
    .btn-abrir:hover {
      background-color: var(--accent-2);
    }
    .btn-resumo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      background-color: var(--bg-soft);
      border: 1px solid var(--line);
      color: var(--text);
      text-decoration: none;
      font-weight: 700;
      font-size: 14.5px;
      padding: 12px 18px;
      border-radius: var(--radius-full);
      transition: border-color 0.15s ease;
    }
    .btn-resumo:hover {
      border-color: var(--accent);
    }
    .btn-copiar {
      background: var(--bg-soft);
      border: 1px solid var(--line);
      color: var(--text);
      padding: 8px 18px;
      border-radius: var(--radius-full);
      cursor: pointer;
      font-size: 13px;
      font-weight: 650;
      transition: border-color 0.15s ease;
    }
    .btn-copiar:hover {
      border-color: var(--accent);
    }
    .rodape {
      margin-top: 6px;
      font-size: 12.5px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  ${renderizarCabecalhoSite()}
  <main class="pagina-main">
    <div class="card">
      <div class="etiqueta">${numeroPr !== null ? `Pull Request #${numeroPr}` : "Sessão ao Vivo"}</div>
      <h1>Prévia de Croqui</h1>
      <p>Conecte seu celular ao Aresta Climb para visualizar o croqui e testar as alterações.</p>

      <div class="codigo-box">
        <div class="codigo-label">Código de Pareamento</div>
        <div class="codigo-valor" id="codigo-val">${codigoFormatado}</div>
      </div>

      ${
        urlQrCodePr
          ? `<a class="qr-container" href="${urlPrevia}" title="QR Code da Prévia (${codigoFormatado})">
        <img src="${urlQrCodePr}" alt="QR Code da Prévia (${codigoFormatado})" width="148" height="148">
      </a>`
          : ""
      }

      <a href="aresta://previa/${codigoFormatado}" class="btn-abrir">Abrir no Aplicativo Aresta</a>
      ${
        numeroPr !== null
          ? `<a href="/resumo/${codigoFormatado}" class="btn-resumo">Ver Resumo de Alterações da PR #${numeroPr}</a>`
          : ""
      }
      <button class="btn-copiar" id="btn-copiar" onclick="copiarCodigo()">Copiar Código</button>

      ${renderizarBotoesLojas()}

      <div class="rodape">
        Abra o aplicativo Aresta Climb no seu celular ou escaneie o QR Code no seu computador.
      </div>
    </div>
  </main>
  ${renderizarRodapeSite()}

  <script>${SCRIPT_ALTERNANCIA_TEMA}
    function copiarCodigo() {
      navigator.clipboard.writeText("${codigoFormatado}").then(() => {
        const btn = document.getElementById("btn-copiar");
        btn.innerText = "Código Copiado!";
        setTimeout(() => { btn.innerText = "Copiar Código"; }, 2000);
      });
    }

    // Apenas em navegadores móveis (Android / iOS) tenta disparar o app link suavemente
    if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) {
      setTimeout(() => {
        window.location.href = "aresta://previa/${codigoFormatado}";
      }, 300);
    }
  </script>
</body>
</html>`;
}

export function criarRespostaJson(dados: any, status = 200, cabecalhosAdicionais: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type, Accept, Upgrade",
      ...cabecalhosAdicionais,
    },
  });
}

function obterParWebSocket(): { clientSocket: WebSocket; serverSocket: WebSocket } {
  const WebSocketPairClass = (globalThis as any).WebSocketPair;
  if (WebSocketPairClass) {
    const pair = new WebSocketPairClass();
    return { clientSocket: pair[0], serverSocket: pair[1] };
  }

  // Fallback para ambiente Deno / Mock
  const client = new EventTarget() as any;
  const server = new EventTarget() as any;
  client.send = (d: any) => server.dispatchEvent(new MessageEvent("message", { data: d }));
  server.send = (d: any) => client.dispatchEvent(new MessageEvent("message", { data: d }));
  client.close = (code?: number, reason?: string) => {
    client.dispatchEvent(new CloseEvent("close", { code, reason }));
    server.dispatchEvent(new CloseEvent("close", { code, reason }));
  };
  server.close = (code?: number, reason?: string) => {
    client.dispatchEvent(new CloseEvent("close", { code, reason }));
    server.dispatchEvent(new CloseEvent("close", { code, reason }));
  };
  server.accept = () => {};
  return { clientSocket: client, serverSocket: server };
}

export async function tratarRequisicao(
  request: Request,
  env?: ContextoWorker,
  gerenciadorInstancia?: GerenciadorSessao,
): Promise<Response> {
  const gerenciadorAtivo = gerenciadorInstancia || gerenciador;
  const url = new URL(request.url);

  try {
    // Tratamento de CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
          "access-control-allow-headers": "Authorization, Content-Type, Accept, Upgrade",
        },
      });
    }

    const pathname = url.pathname.replace(/\/+/g, "/");

    // 1. Rota Raiz / Health Check
    if (pathname === "/" || pathname === ROTA_VERIFICAR_SAUDE_PREVIA) {
      // Se um navegador acessar a raiz sem código de croqui, redireciona para a documentação do editor
      if (
        pathname === "/" &&
        (request.headers.get("accept")?.includes("text/html") ||
          request.headers.get("sec-fetch-dest") === "document")
      ) {
        return Response.redirect("https://arestaclimb.com/editor", 302);
      }

      let sessoesAtivas = gerenciadorAtivo.quantidadeSessoesAtivas();

      if (env?.SESSAO_DO) {
        try {
          const regStub = env.SESSAO_DO.get(env.SESSAO_DO.idFromName("__registro_global__"));
          const respReg = await regStub.fetch("https://previa.arestaclimb.com/__registro__/total");
          if (respReg.ok) {
            const dataReg = (await respReg.json()) as any;
            if (typeof dataReg?.total === "number") {
              sessoesAtivas = dataReg.total;
            }
          }
        } catch {}
      } else if (sessoesAtivas === 0) {
        const totalSupabase = await obterQuantidadeSessoesAtivasBanco(env);
        if (totalSupabase !== null) {
          sessoesAtivas = totalSupabase;
        }
      }

      const respostaSaude: RespostaSaudePrevia = {
        servico: "Aresta Previa Relay",
        status: "operacional",
        sessoesAtivas,
      };
      return criarRespostaJson(respostaSaude);
    }

    // 2. Criação de Sessão de Prévia Autenticada: POST /sessoes ou POST /sessions
    if (request.method === "POST" && (pathname === ROTA_CRIAR_SESSAO_PREVIA || pathname === "/sessions")) {
      const authHeader = request.headers.get("Authorization");
      const token = extrairJwtDeCabecalho(authHeader);

      if (!token) {
        return criarRespostaJson(
          { erro: "Não autorizado: cabeçalho Authorization: Bearer <jwt> é obrigatório." },
          401,
        );
      }

      const funcaoValidarJwt = env?.validarJwt || validarTokenJwt;
      const usuario = await funcaoValidarJwt(token, env);

      if (!usuario) {
        return criarRespostaJson(
          { erro: "Não autorizado: JWT do Supabase inválido ou expirado." },
          401,
        );
      }

      let bodyJson: MetadadosEditor = {};
      try {
        const text = await request.text();
        if (text) bodyJson = JSON.parse(text);
      } catch {}

      const ipOrigem =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("x-forwarded-for") ||
        undefined;
      const userAgent = request.headers.get("user-agent") || undefined;

      const codigoReservado = url.searchParams.get("codigo_reservado");
      const codigoGerado = codigoReservado || gerenciadorAtivo.gerarCodigoUnico();
      const codigoFormatado = gerenciadorAtivo.formatarCodigo(codigoGerado);
      const urlPrevia = `${URL_SERVIDOR_PADRAO}/${codigoFormatado}`;

      // Registra no banco de dados do Supabase
      const idAuditoria = await registrarInicioSessao(
        {
          usuarioId: usuario.idUsuario,
          usuarioEmail: usuario.email,
          codigo: codigoFormatado,
          urlPrevia,
          ipOrigem,
          ipLocal: bodyJson.ipLocal,
          portaLocal: bodyJson.portaLocal,
          userAgent,
        },
        env,
      );

      // Cria a sessão em memória no Cloudflare Worker
      gerenciadorAtivo.criarSessao(
        usuario.idUsuario,
        usuario.email,
        bodyJson,
        ipOrigem,
        userAgent,
        idAuditoria || undefined,
        codigoGerado,
      );

      // Registra no registry global do Durable Object
      if (env?.SESSAO_DO) {
        try {
          const regStub = env.SESSAO_DO.get(env.SESSAO_DO.idFromName("__registro_global__"));
          await regStub.fetch(
            `https://previa.arestaclimb.com/__registro__/adicionar?codigo=${codigoGerado}&usuario=${encodeURIComponent(usuario.idUsuario)}`,
            { method: "POST" },
          );
        } catch {}
      }

      const respostaSessao: RespostaSessaoPrevia = {
        codigo: codigoGerado,
        codigo_formatado: codigoFormatado,
        url_previa: urlPrevia,
        ws_url: `wss://previa.arestaclimb.com${ROTA_CONECTAR_WEBSOCKET_PREVIA}?sessao=${codigoGerado}&token=${encodeURIComponent(token)}`,
        expira_em: 1800,
      };
      return criarRespostaJson(respostaSessao, 201);
    }

    // 3. Android App Links Verification: /.well-known/assetlinks.json
    if (pathname === "/.well-known/assetlinks.json") {
      return criarRespostaJson([
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "app.escalada.croquis",
            sha256_cert_fingerprints: [
              "53:47:51:33:74:B1:E2:6E:57:9A:A8:7D:8C:0C:61:48:33:D5:06:36:52:1D:1D:9D:34:63:03:B3:65:FF:CC:F8",
              "F1:93:B5:26:33:3C:35:F7:EA:72:2D:CD:AD:90:E7:74:32:97:10:6F:FF:B7:FA:DF:EB:B5:E9:E0:7E:F9:C3:D5",
              "36:74:5F:C0:4B:CF:5E:4B:E7:45:7F:D9:32:A3:4B:19:62:0C:C3:6F:8A:F9:CB:11:22:0C:B8:2C:F0:1C:47:9B",
            ],
          },
        },
      ]);
    }

    // 4. iOS Universal Links Verification: /.well-known/apple-app-site-association
    if (pathname === "/.well-known/apple-app-site-association") {
      return criarRespostaJson({
        applinks: {
          apps: [],
          details: [
            {
              appIDs: ["Z74K7R3WU7.app.escalada.croquis"],
              components: [
                {
                  "/": "/resumo/*",
                  exclude: true,
                },
                {
                  "/": "/*",
                },
              ],
              appID: "Z74K7R3WU7.app.escalada.croquis",
              paths: ["NOT /resumo/*", "/*"],
            },
          ],
        },
      });
    }

    // 5. Conexão WebSocket do Editor Desktop: /ws?sessao=k9x2p83a&token=<jwt>
    if (pathname === ROTA_CONECTAR_WEBSOCKET_PREVIA) {
      const sessaoId = url.searchParams.get("sessao") || url.searchParams.get("session");
      if (!sessaoId) {
        return criarRespostaJson({ erro: "Parâmetro 'sessao' obrigatório." }, 400);
      }

      if (gerenciadorAtivo.normalizarCodigo(sessaoId).startsWith("pr")) {
        return criarRespostaJson(
          { erro: "Códigos iniciados com 'pr' são reservados para instâncias de Pull Request." },
          400,
        );
      }

      // Validação de autenticação obrigatória para o túnel do editor
      const token =
        extrairJwtDeCabecalho(request.headers.get("Authorization")) ||
        url.searchParams.get("token");

      if (!token) {
        return criarRespostaJson({ erro: "Não autorizado: token JWT obrigatório." }, 401);
      }

      const funcaoValidarJwt = env?.validarJwt || validarTokenJwt;
      const usuario = await funcaoValidarJwt(token, env);
      if (!usuario) {
        return criarRespostaJson({ erro: "Não autorizado: token inválido ou expirado." }, 401);
      }

      const codigoNormalizado = gerenciadorAtivo.normalizarCodigo(sessaoId);
      let sessaoExistente = gerenciadorAtivo.obterSessao(codigoNormalizado);

      if (!sessaoExistente) {
        // Auto-restauração / Auto-criação da sessão para usuário autenticado (tolerância a cold starts)
        const ipOrigem =
          request.headers.get("CF-Connecting-IP") ||
          request.headers.get("x-forwarded-for") ||
          undefined;
        const userAgent = request.headers.get("user-agent") || undefined;

        sessaoExistente = gerenciadorAtivo.criarSessao(
          usuario.idUsuario,
          usuario.email,
          {},
          ipOrigem,
          userAgent,
          undefined,
          codigoNormalizado,
        );
      } else if (sessaoExistente.usuarioId && sessaoExistente.usuarioId !== usuario.idUsuario) {
        // Valida posse da sessão: impede que um usuário tente controlar a sessão de outro
        return criarRespostaJson(
          { erro: "Acesso negado: a sessão informada pertence a outro usuário." },
          403,
        );
      }

      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        return criarRespostaJson({ erro: "Esperado cabeçalho Upgrade: websocket." }, 426);
      }

      const { clientSocket, serverSocket } = obterParWebSocket();

      if (typeof (serverSocket as any).accept === "function") {
        (serverSocket as any).accept();
      }

      const sessao = gerenciadorAtivo.registrarSessao(codigoNormalizado, serverSocket);

      serverSocket.addEventListener("message", (event: any) => {
        try {
          sessao.ultimoAcessoEm = Date.now();
          const rawData = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
          const dados: MensagemEvento = JSON.parse(rawData);

          if (dados.tipo === "registro" && dados.dados) {
            sessao.metadados = { ...sessao.metadados, ...dados.dados };
            serverSocket.send(JSON.stringify({ tipo: "confirmacao_registro", status: "ok" }));
          } else if (dados.tipo === "evento") {
            console.log(`[DO ${codigoNormalizado}] ⚡ Evento recebido do editor desktop:`, JSON.stringify(dados));
            gerenciadorAtivo.emitirEventoParaOuvintes(codigoNormalizado, dados.dados || dados);
          } else if (dados.tipo === "resposta_proxy" && dados.dados) {
            gerenciadorAtivo.registrarRespostaProxy(codigoNormalizado, dados.dados as RespostaProxy);
          } else if (dados.tipo === "ping") {
            serverSocket.send(JSON.stringify({ tipo: "pong", timestamp: Date.now() }));
          } else if (dados.tipo === "pong") {
            sessao.ultimoAcessoEm = Date.now();
          }
        } catch {}
      });

      serverSocket.addEventListener("close", () => {
        gerenciadorAtivo.desconectarSocketEditor(sessaoId);
      });

      serverSocket.addEventListener("error", () => {
        gerenciadorAtivo.desconectarSocketEditor(sessaoId);
      });

      const responseInit: any = { status: 101 };
      responseInit.webSocket = clientSocket;

      return new Response(null, responseInit);
    }

    // Processamento de rotas com código de sessão: /<codigo>/...
    const partes = pathname.split("/").filter(Boolean);
    if (partes.length === 0) {
      return criarRespostaJson({ erro: "Rota não encontrada" }, 404);
    }

    const fetchServing = env?.executarFetchServing || fetch;

    // 5.1. Relatório Visual HTML de Pull Request: GET /resumo/<codigo_pr>
    if (partes[0] === "resumo" && partes.length >= 2) {
      const numeroPrResumo = gerenciadorAtivo.extrairNumeroPullRequest(partes[1]);
      if (numeroPrResumo === null) {
        return criarRespostaJson({ erro: "Código de Pull Request inválido." }, 400);
      }
      const urlResumoR2 = `https://serving.arestaclimb.com/pr/${numeroPrResumo}/resumo.html`;
      const respResumo = await fetchServing(urlResumoR2);
      if (!respResumo.ok) {
        return new Response(
          renderizarPaginaResumoNaoEncontrado(numeroPrResumo),
          {
            status: 404,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "access-control-allow-origin": "*",
            },
          },
        );
      }
      return new Response(respResumo.body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      });
    }

    const codigoSessao = gerenciadorAtivo.normalizarCodigo(partes[0]);
    const subcaminho = partes.slice(1).join("/");
    const numeroPr = gerenciadorAtivo.extrairNumeroPullRequest(codigoSessao);

    // 5.2. Proxy Stateless para Instâncias de Pull Request (pr*)
    if (numeroPr !== null && subcaminho) {
      if (subcaminho === "info" || subcaminho === "meta") {
        return criarRespostaJson({
          codigo: codigoSessao,
          metadados: {},
          local_url: null,
        });
      }
      if (subcaminho === "events" || subcaminho === "eventos") {
        return criarRespostaJson(
          { erro: "Instâncias de Pull Request não utilizam WebSocket de eventos." },
          404,
        );
      }

      const urlArtefatoR2 = `https://serving.arestaclimb.com/pr/${numeroPr}/${subcaminho}`;
      const cabecalhosUpstream: Record<string, string> = {};
      const ifNoneMatch = request.headers.get("if-none-match");
      if (ifNoneMatch) {
        cabecalhosUpstream["if-none-match"] = ifNoneMatch;
      }

      const respArtefato = await fetchServing(urlArtefatoR2, {
        method: request.method,
        headers: cabecalhosUpstream,
      });

      const cabecalhosSaida: Record<string, string> = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
      };
      const contentType = respArtefato.headers.get("content-type");
      if (contentType) cabecalhosSaida["content-type"] = contentType;
      const etag = respArtefato.headers.get("etag");
      if (etag) cabecalhosSaida["etag"] = etag;
      const cacheControl = respArtefato.headers.get("cache-control");
      if (cacheControl) cabecalhosSaida["cache-control"] = cacheControl;

      return new Response(respArtefato.body, {
        status: respArtefato.status,
        headers: cabecalhosSaida,
      });
    }

    // 6. Conexão WebSocket para Ouvintes (Live Reload): /<codigo>/events
    if (subcaminho === "events" || subcaminho === "eventos") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        return criarRespostaJson({ erro: "Esperado cabeçalho Upgrade: websocket." }, 426);
      }

      const sessao = gerenciadorAtivo.obterSessao(codigoSessao);
      if (!sessao) {
        return criarRespostaJson({ erro: "Sessão não encontrada ou expirada." }, 404);
      }

      const { clientSocket, serverSocket } = obterParWebSocket();

      if (typeof (serverSocket as any).accept === "function") {
        (serverSocket as any).accept();
      }
      gerenciadorAtivo.adicionarOuvinte(codigoSessao, serverSocket);

      serverSocket.addEventListener("close", () => {
        gerenciadorAtivo.removerOuvinte(codigoSessao, serverSocket);
      });

      const responseInit: any = { status: 101 };
      responseInit.webSocket = clientSocket;
      return new Response(null, responseInit);
    }

    // 7. Landing Page HTML de Prévia: /<codigo>
    if (!subcaminho) {
      const codigoFormatado = gerenciadorAtivo.formatarCodigo(codigoSessao);
      const html = renderizarPaginaPrevia(codigoFormatado, numeroPr);

      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      });
    }

    // 8. Consulta de Metadados / Descoberta LAN: /<codigo>/info ou /<codigo>/meta
    if (subcaminho === "info" || subcaminho === "meta") {
      const sessao = gerenciadorAtivo.obterSessao(codigoSessao);
      if (!sessao) {
        return criarRespostaJson({ erro: "Sessão não encontrada ou expirada." }, 404);
      }

      const respostaMeta: MetadadosSessaoPrevia = {
        codigo: sessao.codigo,
        criadoEm: sessao.criadoEm,
        ultimoAcessoEm: sessao.ultimoAcessoEm,
        metadados: sessao.metadados,
      };
      return criarRespostaJson(respostaMeta);
    }

    // 9. Proxy Reverso para o Desktop do Usuário: /<codigo>/*
    const sessao = gerenciadorAtivo.obterSessao(codigoSessao);
    if (!sessao) {
      return criarRespostaJson({ erro: "Sessão não encontrada ou expirada." }, 404);
    }

    if (!sessao.socketEditor) {
      return criarRespostaJson({ erro: "Editor desktop ainda não conectado a esta sessão." }, 503);
    }

    const idRequisicao = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const cabecalhosRequisicao: Record<string, string> = {};
    request.headers.forEach((valor, chave) => {
      cabecalhosRequisicao[chave.toLowerCase()] = valor;
    });

    const mensagemProxy: MensagemEvento = {
      tipo: "requisicao_proxy",
      dados: {
        id: idRequisicao,
        metodo: request.method,
        caminho: `/${subcaminho}`,
        cabecalhos: cabecalhosRequisicao,
      } as RequisicaoProxy,
    };

    return new Promise<Response>((resolve) => {
      const timerTimeout = setTimeout(() => {
        sessao.requisicoesPendentes.delete(idRequisicao);
        resolve(criarRespostaJson({ erro: "Timeout aguardando resposta do editor desktop." }, 504));
      }, 15000); // 15 segundos de timeout

      sessao.requisicoesPendentes.set(idRequisicao, (respostaProxy: RespostaProxy) => {
        clearTimeout(timerTimeout);

        const cabecalhosResposta: Record<string, string> = {
          "access-control-allow-origin": "*",
          ...(respostaProxy.cabecalhos || {}),
        };

        let corpo: BodyInit | null = null;
        if (respostaProxy.corpoBase64) {
          const binStr = atob(respostaProxy.corpoBase64);
          const len = binStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binStr.charCodeAt(i);
          }
          corpo = bytes;
        }

        resolve(
          new Response(corpo, {
            status: respostaProxy.status || 200,
            headers: cabecalhosResposta,
          }),
        );
      });

      try {
        sessao.socketEditor!.send(JSON.stringify(mensagemProxy));
      } catch {
        clearTimeout(timerTimeout);
        sessao.requisicoesPendentes.delete(idRequisicao);
        resolve(criarRespostaJson({ erro: "Falha ao enviar requisição ao editor desktop." }, 502));
      }
    });
  } catch (erro) {
    console.error(`[Worker] Erro inesperado ao processar requisição: ${erro}`);
    await relatarErroSentry(
      erro,
      {
        dsn: env?.SENTRY_DSN,
        servico: "cloudflare-previa",
        requisicao: request,
      },
      env?.relatorSentry,
    );
    return criarRespostaJson({ erro: "Erro interno do servidor." }, 500);
  }
}

/**
 * Durable Object para gerenciamento de sessão unificado e globalmente sincronizado.
 */
export class SessaoDurableObject {
  public gerenciador: GerenciadorSessao;
  private env?: ContextoWorker;
  private state: any;
  private sessoesRegistradas = new Map<string, { timestamp: number; usuarioId?: string }>();

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
    this.gerenciador = new GerenciadorSessao();
    this.gerenciador.aoEncerrarSessao = (sessao, motivo, duracaoSegundos) => {
      registrarFimSessao(sessao.idAuditoria || sessao.codigo, {
        encerradoEm: new Date().toISOString(),
        duracaoSegundos,
        motivoEncerramento: motivo,
      });

      // Remove os metadados do storage do Durable Object
      if (this.state?.storage?.delete) {
        this.state.storage.delete(`sessao_meta:${sessao.codigo}`).catch(() => {});
      }

      // Notifica o registro global sobre o encerramento da sessão
      if (this.env?.SESSAO_DO) {
        try {
          const regStub = this.env.SESSAO_DO.get(this.env.SESSAO_DO.idFromName("__registro_global__"));
          regStub
            .fetch(
              `https://previa.arestaclimb.com/__registro__/remover?codigo=${sessao.codigo}`,
              { method: "POST" },
            )
            .catch(() => {});
        } catch {}
      }
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+/g, "/");

    // Endpoints internos de agregação global de métricas / sessões ativas
    if (pathname.startsWith("/__registro__/")) {
      const agora = Date.now();

      if (pathname === "/__registro__/adicionar") {
        const cod = url.searchParams.get("codigo");
        const usr = url.searchParams.get("usuario") || undefined;
        if (cod) {
          this.sessoesRegistradas.set(cod, { timestamp: agora, usuarioId: usr });
          if (this.state?.storage?.put) {
            await this.state.storage.put(`sessao:${cod}`, { timestamp: agora, usuarioId: usr });
          }
        }
        return criarRespostaJson({ ok: true });
      }

      if (pathname === "/__registro__/remover") {
        const cod = url.searchParams.get("codigo");
        if (cod) {
          this.sessoesRegistradas.delete(cod);
          if (this.state?.storage?.delete) {
            await this.state.storage.delete(`sessao:${cod}`);
          }
        }
        return criarRespostaJson({ ok: true });
      }

      if (pathname === "/__registro__/total") {
        let total = 0;
        if (this.state?.storage?.list) {
          const map = await this.state.storage.list({ prefix: "sessao:" });
          for (const [key, val] of map.entries()) {
            if (agora - ((val as any)?.timestamp || 0) > 30 * 60 * 1000) {
              await this.state.storage.delete(key);
            } else {
              total++;
            }
          }
        } else {
          for (const [cod, item] of Array.from(this.sessoesRegistradas.entries())) {
            if (agora - item.timestamp > 30 * 60 * 1000) {
              this.sessoesRegistradas.delete(cod);
            } else {
              total++;
            }
          }
        }
        return criarRespostaJson({ total });
      }
    }

    // Extrai o código da sessão para verificação e restauração de storage
    let codigoSessao: string | null = null;
    if (pathname === "/sessoes" || pathname === "/sessions") {
      codigoSessao = url.searchParams.get("codigo_reservado");
    } else if (pathname === "/ws") {
      codigoSessao = url.searchParams.get("sessao") || url.searchParams.get("session");
    } else {
      const partes = pathname.split("/").filter(Boolean);
      if (partes.length > 0) {
        codigoSessao = partes[0];
      }
    }

    if (codigoSessao) {
      const normalizado = this.gerenciador.normalizarCodigo(codigoSessao);
      if (!this.gerenciador.obterSessao(normalizado) && this.state?.storage?.get) {
        try {
          const dadosStorage = await this.state.storage.get(`sessao_meta:${normalizado}`);
          if (dadosStorage) {
            this.gerenciador.criarSessao(
              dadosStorage.usuarioId,
              dadosStorage.usuarioEmail,
              dadosStorage.metadados || {},
              dadosStorage.ipOrigem,
              dadosStorage.userAgent,
              dadosStorage.idAuditoria,
              normalizado,
            );
          }
        } catch {}
      }
    }

    const resposta = await tratarRequisicao(request, this.env, this.gerenciador);

    // Se a sessão existe no gerenciador após o tratamento da requisição, persiste no storage
    if (codigoSessao && this.state?.storage?.put) {
      const normalizado = this.gerenciador.normalizarCodigo(codigoSessao);
      const sessaoAtiva = this.gerenciador.obterSessao(normalizado);
      if (sessaoAtiva) {
        try {
          await this.state.storage.put(`sessao_meta:${normalizado}`, {
            codigo: sessaoAtiva.codigo,
            usuarioId: sessaoAtiva.usuarioId,
            usuarioEmail: sessaoAtiva.usuarioEmail,
            metadados: sessaoAtiva.metadados,
            ipOrigem: sessaoAtiva.ipOrigem,
            userAgent: sessaoAtiva.userAgent,
            idAuditoria: sessaoAtiva.idAuditoria,
            criadoEm: sessaoAtiva.criadoEm,
          });
        } catch {}
      }
    }

    return resposta;
  }
}

export default Sentry.withSentry(
  (env?: ContextoWorker) => ({
    dsn: env?.SENTRY_DSN,
    beforeSend(event: any) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["x-api-key"];
      }
      return event;
    },
  }),
  {
    async fetch(request: Request, env?: ContextoWorker): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+/g, "/");

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
          "access-control-allow-headers": "Authorization, Content-Type, Accept, Upgrade",
        },
      });
    }

    // Rotas globais / health / well-known / resumo de PR
    const gmAtivo = env?.gerenciadorPersonalizado || gerenciador;
    if (
      pathname === "/" ||
      pathname === "/health" ||
      pathname.startsWith("/.well-known/") ||
      pathname.startsWith("/resumo/")
    ) {
      return tratarRequisicao(request, env, gmAtivo);
    }

    // Encaminha requisições com código de sessão para o Durable Object correspondente
    // (exceto códigos reservados de Pull Request 'pr*', que são 100% stateless)
    if (env?.SESSAO_DO) {
      let codigoSessao: string | null = null;

      if (pathname === "/sessoes" || pathname === "/sessions") {
        const codigo = gmAtivo.gerarCodigoUnico();
        const urlModificada = new URL(request.url);
        urlModificada.searchParams.set("codigo_reservado", codigo);
        const id = env.SESSAO_DO.idFromName(codigo);
        const stub = env.SESSAO_DO.get(id);
        const novaReq = new Request(urlModificada.toString(), request);
        return stub.fetch(novaReq);
      }

      if (pathname === "/ws") {
        codigoSessao = url.searchParams.get("sessao") || url.searchParams.get("session");
      } else {
        const partes = pathname.split("/").filter(Boolean);
        if (partes.length > 0) {
          codigoSessao = partes[0];
        }
      }

      if (codigoSessao) {
        const codigoNormalizado = gmAtivo.normalizarCodigo(codigoSessao);
        if (!codigoNormalizado.startsWith("pr")) {
          const id = env.SESSAO_DO.idFromName(codigoNormalizado);
          const stub = env.SESSAO_DO.get(id);
          return stub.fetch(request);
        }
      }
    }

    return tratarRequisicao(request, env, gmAtivo);
  },
}
);
