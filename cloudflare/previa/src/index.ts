// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { GerenciadorSessao } from "./gerenciador_sessao.ts";
import { MensagemEvento, RequisicaoProxy, RespostaProxy, MetadadosEditor } from "./tipos.ts";
import { validarTokenJwt, extrairJwtDeCabecalho } from "./validador_jwt.ts";
import { registrarInicioSessao, registrarFimSessao } from "./cliente_auditoria_supabase.ts";

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
  validarJwt?: typeof validarTokenJwt;
  gerenciadorPersonalizado?: GerenciadorSessao;
}

export function criarRespostaJson(dados: any, status = 200, cabecalhosAdicionais: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
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

export default {
  async fetch(request: Request, env?: ContextoWorker): Promise<Response> {
    const url = new URL(request.url);
    const gerenciadorAtivo = env?.gerenciadorPersonalizado || gerenciador;

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
    if (pathname === "/" || pathname === "/health") {
      // Se um navegador acessar a raiz sem código de croqui, redireciona para a documentação do editor
      if (
        pathname === "/" &&
        (request.headers.get("accept")?.includes("text/html") ||
          request.headers.get("sec-fetch-dest") === "document")
      ) {
        return Response.redirect("https://arestaclimb.com/editor", 302);
      }

      return criarRespostaJson({
        servico: "Aresta Previa Relay",
        status: "operacional",
        sessoesAtivas: gerenciadorAtivo.quantidadeSessoesAtivas(),
      });
    }

    // 2. Criação de Sessão de Prévia Autenticada: POST /sessoes ou POST /sessions
    if (request.method === "POST" && (pathname === "/sessoes" || pathname === "/sessions")) {
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

      const codigoGerado = gerenciadorAtivo.gerarCodigoUnico();
      const codigoFormatado = gerenciadorAtivo.formatarCodigo(codigoGerado);
      const urlPrevia = `https://previa.arestaclimb.com/${codigoFormatado}`;

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

      return criarRespostaJson(
        {
          codigo: codigoGerado,
          codigo_formatado: codigoFormatado,
          url_previa: urlPrevia,
          ws_url: `wss://previa.arestaclimb.com/ws?sessao=${codigoGerado}&token=${encodeURIComponent(token)}`,
          expira_em: 1800,
        },
        201,
      );
    }

    // 3. Android App Links Verification: /.well-known/assetlinks.json
    if (pathname === "/.well-known/assetlinks.json") {
      return criarRespostaJson([
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "com.arestaclimb.app",
            sha256_cert_fingerprints: [
              "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
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
              appID: "TEAMID1234.com.arestaclimb.app",
              paths: ["/*"],
            },
          ],
        },
      });
    }

    // 5. Conexão WebSocket do Editor Desktop: /ws?sessao=k9x2p83a&token=<jwt>
    if (pathname === "/ws") {
      const sessaoId = url.searchParams.get("sessao") || url.searchParams.get("session");
      if (!sessaoId) {
        return criarRespostaJson({ erro: "Parâmetro 'sessao' obrigatório." }, 400);
      }

      const codigoNormalizado = gerenciadorAtivo.normalizarCodigo(sessaoId);
      const sessaoExistente = gerenciadorAtivo.obterSessao(codigoNormalizado);
      if (!sessaoExistente) {
        return criarRespostaJson(
          { erro: "Sessão não encontrada ou expirada. Crie a sessão previamente via POST /sessoes." },
          404,
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

      // Valida posse da sessão: impede que um usuário tente controlar a sessão de outro
      if (sessaoExistente.usuarioId && sessaoExistente.usuarioId !== usuario.idUsuario) {
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
          const rawData = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
          const dados: MensagemEvento = JSON.parse(rawData);

          if (dados.tipo === "registro" && dados.dados) {
            sessao.metadados = { ...sessao.metadados, ...dados.dados };
            serverSocket.send(JSON.stringify({ tipo: "confirmacao_registro", status: "ok" }));
          } else if (dados.tipo === "evento") {
            gerenciadorAtivo.emitirEventoParaOuvintes(sessaoId, dados.dados || dados);
          } else if (dados.tipo === "resposta_proxy" && dados.dados) {
            gerenciadorAtivo.registrarRespostaProxy(sessaoId, dados.dados as RespostaProxy);
          } else if (dados.tipo === "ping") {
            serverSocket.send(JSON.stringify({ tipo: "pong", timestamp: Date.now() }));
          }
        } catch {}
      });

      serverSocket.addEventListener("close", () => {
        gerenciadorAtivo.removerSessao(sessaoId, 1000, "desconexao_editor");
      });

      serverSocket.addEventListener("error", () => {
        gerenciadorAtivo.removerSessao(sessaoId, 1006, "erro_socket_editor");
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

    const codigoSessao = partes[0];
    const subcaminho = partes.slice(1).join("/");

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
    .rodape {
      margin-top: 20px;
      font-size: 12px;
      color: var(--cor-subtexto);
    }
  </style>
  <script>
    // Tenta abrir diretamente o aplicativo móvel via Custom Scheme
    window.location.href = "aresta://previa/${codigoFormatado}";
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">🧗</div>
    <h1>Prévia de Croqui</h1>
    <p>Conecte seu celular ao Aresta Editor para visualizar o croqui em tempo real.</p>
    
    <div class="codigo-box">
      <div class="codigo-label">Código de Pareamento</div>
      <div class="codigo-valor">${codigoFormatado}</div>
    </div>

    <a href="aresta://previa/${codigoFormatado}" class="btn-abrir">Abrir no Aplicativo Aresta</a>

    <div class="rodape">
      Abra o aplicativo Aresta Climb no seu celular ou escaneie o QR Code no seu computador.
    </div>
  </div>
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

      return criarRespostaJson({
        codigo: sessao.codigo,
        criadoEm: sessao.criadoEm,
        ultimoAcessoEm: sessao.ultimoAcessoEm,
        metadados: sessao.metadados,
      });
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
      tipo: "resposta_proxy",
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
        sessao.socketEditor?.send(JSON.stringify(mensagemProxy));
      } catch (err) {
        sessao.requisicoesPendentes.delete(idRequisicao);
        clearTimeout(timerTimeout);
        resolve(criarRespostaJson({ erro: "Falha na comunicação com o editor desktop." }, 502));
      }
    });
  },
};
