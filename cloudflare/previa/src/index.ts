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
          `<!DOCTYPE html><html lang="pt-BR"><body><h1>Resumo da PR #${numeroPrResumo} não encontrado (404)</h1></body></html>`,
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
      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aresta Climb - Prévia do Croqui</title>
  <style>
    :root {
      --cor-fundo: #0f172a;
      --cor-card: #1e293b;
      --cor-destaque: #e07a5f;
      --cor-texto: #f8fafc;
      --cor-subtexto: #94a3b8;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--cor-fundo);
      color: var(--cor-texto);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background-color: var(--cor-card);
      border-radius: 20px;
      padding: 32px 24px;
      max-width: 420px;
      width: 90%;
      text-align: center;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .logo {
      font-size: 40px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 8px 0;
      color: var(--cor-texto);
    }
    p {
      color: var(--cor-subtexto);
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }
    .codigo-box {
      background-color: #0b1120;
      border: 1px dashed var(--cor-destaque);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .codigo-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--cor-destaque);
      margin-bottom: 4px;
      font-weight: 600;
    }
    .codigo-valor {
      font-size: 28px;
      font-family: monospace;
      font-weight: 700;
      letter-spacing: 2px;
      color: #fff;
    }
    .btn-abrir {
      display: block;
      width: 100%;
      background-color: var(--cor-destaque);
      color: #ffffff;
      text-decoration: none;
      font-weight: 700;
      font-size: 16px;
      padding: 14px 0;
      border-radius: 12px;
      box-sizing: border-box;
      transition: opacity 0.2s;
    }
    .btn-abrir:hover {
      opacity: 0.9;
    }
    .btn-copiar {
      margin-top: 10px;
      background: transparent;
      border: 1px solid #334155;
      color: #94a3b8;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    .btn-copiar:hover {
      background: #334155;
      color: #fff;
    }
    .rodape {
      margin-top: 20px;
      font-size: 12px;
      color: var(--cor-subtexto);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🧗</div>
    <h1>Prévia de Croqui</h1>
    <p>Conecte seu celular ao Aresta Editor para visualizar o croqui em tempo real.</p>
    
    <div class="codigo-box">
      <div class="codigo-label">Código de Pareamento</div>
      <div class="codigo-valor" id="codigo-val">${codigoFormatado}</div>
    </div>

    <a href="aresta://previa/${codigoFormatado}" class="btn-abrir">Abrir no Aplicativo Aresta</a>
    ${numeroPr !== null ? `<a href="/resumo/${codigoFormatado}" class="btn-abrir" style="margin-top: 10px; background-color: #3b82f6;">Ver Resumo de Alterações da PR #${numeroPr}</a>` : ""}
    <button class="btn-copiar" id="btn-copiar" onclick="copiarCodigo()">Copiar Código</button>

    <div class="rodape">
      Abra o aplicativo Aresta Climb no seu celular ou escaneie o QR Code no seu computador.
    </div>
  </div>

  <script>
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
