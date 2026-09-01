// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { expect } from "jsr:@std/expect";
import { GerenciadorSessao } from "../src/gerenciador_sessao.ts";
import worker, { gerenciador } from "../src/index.ts";
import { validarTokenJwt, decodificarPayloadJwt, extrairJwtDeCabecalho } from "../src/validador_jwt.ts";
import { registrarInicioSessao, registrarFimSessao } from "../src/cliente_auditoria_supabase.ts";

class FakeWebSocket {
  public sent: string[] = [];
  public closed = false;
  public closeCode?: number;
  public closeReason?: string;
  private listeners: Record<string, ((...args: any[]) => void)[]> = {};

  send(data: string) {
    if (this.closed) throw new Error("Socket fechado");
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit("close");
  }

  addEventListener(event: string, cb: (...args: any[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  emit(event: string, ...args: any[]) {
    const list = this.listeners[event] || [];
    for (const cb of list) cb(...args);
  }
}

// Cria um JWT mock válido para os testes
function criarJwtMock(payload: Record<string, any>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "");
  const corpo = btoa(JSON.stringify(payload)).replace(/=/g, "");
  const sig = "fake_signature_abc123";
  return `${header}.${corpo}.${sig}`;
}

// -----------------------------------------------------------------------------
// Testes do Gerenciador de Sessão
// -----------------------------------------------------------------------------

Deno.test("GerenciadorSessao - deve registrar nova sessão com código normalizado", () => {
  const gerenciadorLocal = new GerenciadorSessao();
  const socketMock = new FakeWebSocket();

  const sessao = gerenciadorLocal.registrarSessao("K9X2-P83A", socketMock as any, {
    urlLocal: "http://192.168.1.50:8421",
  });

  expect(sessao.codigo).toBe("k9x2p83a");
  expect(sessao.metadados.urlLocal).toBe("http://192.168.1.50:8421");
  expect(gerenciadorLocal.obterSessao("k9x2p83a")).toBeDefined();
  expect(gerenciadorLocal.obterSessao("K9X2-P83A")).toBeDefined();
  expect(gerenciadorLocal.quantidadeSessoesAtivas()).toBe(1);
});

Deno.test("GerenciadorSessao - deve gerar código único aleatório em Base36", () => {
  const gerenciadorLocal = new GerenciadorSessao();
  const c1 = gerenciadorLocal.gerarCodigoUnico();
  const c2 = gerenciadorLocal.gerarCodigoUnico();

  expect(c1.length).toBe(8);
  expect(c2.length).toBe(8);
  expect(c1).not.toBe(c2);
  expect(/^[0-9a-z]{8}$/.test(c1)).toBe(true);
  expect(gerenciadorLocal.formatarCodigo(c1)).toBe(`${c1.substring(0, 4)}-${c1.substring(4)}`);
});

Deno.test("GerenciadorSessao - deve criar sessão pré-reservada e disparar callback de encerramento", () => {
  const gerenciadorLocal = new GerenciadorSessao();
  let auditoriaEncerrada: any = null;

  gerenciadorLocal.aoEncerrarSessao = (sessao, motivo, duracao) => {
    auditoriaEncerrada = { sessao, motivo, duracao };
  };

  const sessao = gerenciadorLocal.criarSessao(
    "usr_123",
    "escalador@aresta.com",
    { ipLocal: "192.168.1.10" },
    "203.0.113.1",
    "ArestaDesktop/1.0",
    "audit_uuid_999",
  );

  expect(sessao.usuarioId).toBe("usr_123");
  expect(sessao.idAuditoria).toBe("audit_uuid_999");
  expect(gerenciadorLocal.obterSessao(sessao.codigo)).toBeDefined();

  gerenciadorLocal.removerSessao(sessao.codigo, 1000, "desconexao_editor");
  expect(auditoriaEncerrada).toBeDefined();
  expect(auditoriaEncerrada.motivo).toBe("desconexao_editor");
  expect(gerenciadorLocal.obterSessao(sessao.codigo)).toBeUndefined();
});

Deno.test("GerenciadorSessao - deve adicionar e remover ouvintes e emitir eventos de Live Reload", () => {
  const gerenciadorLocal = new GerenciadorSessao();
  const socketEditor = new FakeWebSocket();
  const ouvinte1 = new FakeWebSocket();
  const ouvinte2 = new FakeWebSocket();

  gerenciadorLocal.registrarSessao("k9x2p83a", socketEditor as any);
  gerenciadorLocal.adicionarOuvinte("k9x2p83a", ouvinte1 as any);
  gerenciadorLocal.adicionarOuvinte("k9x2p83a", ouvinte2 as any);

  gerenciadorLocal.emitirEventoParaOuvintes("k9x2p83a", {
    tipo: "recarregar_setor",
    setor: "br_mg_ferros_setor1",
  });

  expect(ouvinte1.sent.length).toBe(1);
  expect(ouvinte2.sent.length).toBe(1);
  expect(ouvinte1.sent[0]).toContain("br_mg_ferros_setor1");

  gerenciadorLocal.removerOuvinte("k9x2p83a", ouvinte1 as any);
  gerenciadorLocal.emitirEventoParaOuvintes("k9x2p83a", { tipo: "ping" });

  expect(ouvinte1.sent.length).toBe(1);
  expect(ouvinte2.sent.length).toBe(2);
});

// -----------------------------------------------------------------------------
// Testes do Validador JWT
// -----------------------------------------------------------------------------

Deno.test("Validador JWT - deve falhar se Supabase NÃO estiver configurado no ambiente", async () => {
  const jwt = criarJwtMock({
    sub: "usr_abc_123",
    email: "renato@arestaclimb.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  // Sem credenciais de Supabase no ambiente -> deve retornar null
  const resultadoSemConfig = await validarTokenJwt(`Bearer ${jwt}`, {});
  expect(resultadoSemConfig).toBeNull();
});

Deno.test("Validador JWT - deve validar com sucesso quando Supabase Auth responder 200", async () => {
  const jwt = criarJwtMock({
    sub: "usr_abc_123",
    email: "renato@arestaclimb.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  expect(extrairJwtDeCabecalho(`Bearer ${jwt}`)).toBe(jwt);

  const mockFetch: typeof fetch = async (input, init) => {
    expect(init?.headers).toBeDefined();
    return new Response(
      JSON.stringify({
        id: "usr_abc_123",
        email: "renato@arestaclimb.com",
        user_metadata: { nome_completo: "Renato Silva" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const usuario = await validarTokenJwt(`Bearer ${jwt}`, {
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mock_123",
    executarFetch: mockFetch,
  });

  expect(usuario).toBeDefined();
  expect(usuario!.idUsuario).toBe("usr_abc_123");
  expect(usuario!.email).toBe("renato@arestaclimb.com");
  expect(usuario!.nomeCompleto).toBe("Renato Silva");
});

Deno.test("Validador JWT - deve rejeitar se Supabase Auth responder 401 ou token inválido", async () => {
  const jwt = criarJwtMock({
    sub: "usr_invalido",
    email: "invalido@aresta.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const mockFetch401: typeof fetch = async () => {
    return new Response(JSON.stringify({ error: "invalid_jwt" }), { status: 401 });
  };

  const usuario = await validarTokenJwt(`Bearer ${jwt}`, {
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mock_123",
    executarFetch: mockFetch401,
  });

  expect(usuario).toBeNull();
  expect(await validarTokenJwt("token_invalido_sem_pontos")).toBeNull();
  expect(await validarTokenJwt("")).toBeNull();
  expect(await validarTokenJwt(null)).toBeNull();
});

// -----------------------------------------------------------------------------
// Testes de Auditoria Supabase
// -----------------------------------------------------------------------------

Deno.test("Cliente Auditoria Supabase - deve registrar início e fim de sessão com fetch mock", async () => {
  let requisicaoInicio: any = null;
  let requisicaoFim: any = null;

  const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();
    if (init?.method === "POST" && urlStr.includes("/auditoria_sessoes_previa")) {
      requisicaoInicio = JSON.parse(init.body as string);
      return new Response(JSON.stringify([{ id: "uuid-audit-1234" }]), { status: 201 });
    }
    if (init?.method === "PATCH" && urlStr.includes("/auditoria_sessoes_previa")) {
      requisicaoFim = JSON.parse(init.body as string);
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  };

  const idCriado = await registrarInicioSessao(
    {
      usuarioId: "usr_123",
      usuarioEmail: "teste@aresta.com",
      codigo: "k9x2-p83a",
      urlPrevia: "https://previa.arestaclimb.com/k9x2-p83a",
      ipOrigem: "177.18.20.30",
      ipLocal: "192.168.1.15",
      portaLocal: 8421,
      userAgent: "ArestaEditor/1.0",
    },
    {
      SUPABASE_URL: "https://mock.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "mock_secret_key",
      executarFetch: mockFetch,
    },
  );

  expect(idCriado).toBe("uuid-audit-1234");
  expect(requisicaoInicio.usuario_id).toBe("usr_123");
  expect(requisicaoInicio.ip_origem).toBe("177.18.20.30");
  expect(requisicaoInicio.ip_local).toBe("192.168.1.15");

  const sucessoFim = await registrarFimSessao(
    "uuid-audit-1234",
    {
      encerradoEm: new Date().toISOString(),
      duracaoSegundos: 120,
      motivoEncerramento: "desconexao_editor",
    },
    {
      SUPABASE_URL: "https://mock.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "mock_secret_key",
      executarFetch: mockFetch,
    },
  );

  expect(sucessoFim).toBe(true);
  expect(requisicaoFim.duracao_segundos).toBe(120);
  expect(requisicaoFim.motivo_encerramento).toBe("desconexao_editor");
});

// -----------------------------------------------------------------------------
// Testes dos Endpoints HTTP do Cloudflare Worker
// -----------------------------------------------------------------------------

Deno.test("Worker HTTP - deve responder CORS preflight OPTIONS", async () => {
  const req = new Request("https://previa.arestaclimb.com/health", { method: "OPTIONS" });
  const res = await worker.fetch(req);
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

Deno.test("Worker HTTP - deve responder health check na rota /health", async () => {
  const req = new Request("https://previa.arestaclimb.com/health");
  const res = await worker.fetch(req);
  expect(res.status).toBe(200);
  const json = (await res.json()) as any;
  expect(json.status).toBe("operacional");
});

Deno.test("Worker HTTP - deve redirecionar navegadores na raiz para arestaclimb.com/editor", async () => {
  const req = new Request("https://previa.arestaclimb.com/", {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const res = await worker.fetch(req);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://arestaclimb.com/editor");
});

Deno.test("Worker HTTP - POST /sessoes deve rejeitar requisição sem JWT ou com token inválido", async () => {
  // Sem Authorization
  const reqSemAuth = new Request("https://previa.arestaclimb.com/sessoes", { method: "POST" });
  const resSemAuth = await worker.fetch(reqSemAuth);
  expect(resSemAuth.status).toBe(401);

  // Com JWT inválido
  const reqInvalido = new Request("https://previa.arestaclimb.com/sessoes", {
    method: "POST",
    headers: { Authorization: "Bearer token_invalido" },
  });
  const resInvalido = await worker.fetch(reqInvalido);
  expect(resInvalido.status).toBe(401);
});

Deno.test("Worker HTTP - POST /sessoes deve criar sessão gerando código no servidor com JWT válido", async () => {
  const jwt = criarJwtMock({
    sub: "usr_editor_123",
    email: "escalador@arestaclimb.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const mockEnv = {
    validarJwt: async (t: string | null) => {
      if (!t || t.includes("invalido")) return null;
      return { idUsuario: "usr_editor_123", email: "escalador@arestaclimb.com" };
    },
  };

  const req = new Request("https://previa.arestaclimb.com/sessoes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "179.180.200.5",
      "User-Agent": "ArestaEditorDesktop/1.0",
    },
    body: JSON.stringify({ ipLocal: "192.168.1.100", portaLocal: 8888 }),
  });

  const res = await worker.fetch(req, mockEnv);
  expect(res.status).toBe(201);
  const json = (await res.json()) as any;

  expect(json.codigo).toBeDefined();
  expect(json.codigo.length).toBe(8);
  expect(json.codigo_formatado).toBe(`${json.codigo.substring(0, 4)}-${json.codigo.substring(4)}`);
  expect(json.url_previa).toBe(`https://previa.arestaclimb.com/${json.codigo_formatado}`);
  expect(json.ws_url).toContain(`sessao=${json.codigo}`);

  const sessaoMemoria = gerenciador.obterSessao(json.codigo);
  expect(sessaoMemoria).toBeDefined();
  expect(sessaoMemoria!.usuarioId).toBe("usr_editor_123");
  expect(sessaoMemoria!.metadados.ipLocal).toBe("192.168.1.100");
  expect(sessaoMemoria!.ipOrigem).toBe("179.180.200.5");
});

Deno.test("Worker HTTP - deve aceitar WebSocket no endpoint /ws e vincular à sessão", async () => {
  const jwt = criarJwtMock({
    sub: "usr_editor_123",
    email: "escalador@arestaclimb.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const mockEnv = {
    validarJwt: async (t: string | null) => {
      if (!t || t.includes("invalido")) return null;
      return { idUsuario: "usr_editor_123", email: "escalador@arestaclimb.com" };
    },
  };

  // 1. Cria a sessão via POST
  const reqPost = new Request("https://previa.arestaclimb.com/sessoes", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const resPost = await worker.fetch(reqPost, mockEnv);
  const jsonPost = (await resPost.json()) as any;
  const codigo = jsonPost.codigo;

  // 2. Conecta via WebSocket
  const reqWs = new Request(`https://previa.arestaclimb.com/ws?sessao=${codigo}&token=${jwt}`, {
    headers: { Upgrade: "websocket" },
  });
  const resWs = await worker.fetch(reqWs, mockEnv);
  expect(resWs.status).toBe(101);

  const sessao = gerenciador.obterSessao(codigo);
  expect(sessao).toBeDefined();
  expect(sessao!.socketEditor).toBeDefined();
});

Deno.test("Worker HTTP - deve servir fallback Landing Page HTML para navegadores", async () => {
  const req = new Request("https://previa.arestaclimb.com/k9x2-p83a", {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const res = await worker.fetch(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("Prévia de Croqui");
  expect(html).toContain("k9x2-p83a");
  expect(html).toContain("aresta://previa/k9x2-p83a");
});

Deno.test("Worker HTTP - deve retornar 404 para sessão inexistente", async () => {
  const req = new Request("https://previa.arestaclimb.com/inexiste/info");
  const res = await worker.fetch(req);
  expect(res.status).toBe(404);
});

Deno.test("Worker HTTP - deve retornar metadados da sessão ativa", async () => {
  const sessoes = (gerenciador as any).sessoes as Map<string, any>;
  sessoes.clear();

  const socket = new FakeWebSocket();
  gerenciador.registrarSessao("k9x2p83a", socket as any, {
    ipLocal: "192.168.1.50",
    portaLocal: 8421,
  });

  const req = new Request("https://previa.arestaclimb.com/k9x2p83a/info");
  const res = await worker.fetch(req);
  expect(res.status).toBe(200);
  const json = (await res.json()) as any;
  expect(json.codigo).toBe("k9x2p83a");
  expect(json.metadados.ipLocal).toBe("192.168.1.50");
});

Deno.test("Worker HTTP - deve encaminhar requisição via proxy e resolver resposta", async () => {
  const sessoes = (gerenciador as any).sessoes as Map<string, any>;
  sessoes.clear();

  const socket = new FakeWebSocket();
  gerenciador.registrarSessao("k9x2p83a", socket as any);

  const req = new Request("https://previa.arestaclimb.com/k9x2p83a/indice.binarypb");
  const promessaFetch = worker.fetch(req);

  expect(socket.sent.length).toBe(1);
  const payload = JSON.parse(socket.sent[0]);
  expect(payload.tipo).toBe("resposta_proxy");
  expect(payload.dados.caminho).toBe("/indice.binarypb");

  gerenciador.registrarRespostaProxy("k9x2p83a", {
    id: payload.dados.id,
    status: 200,
    cabecalhos: { "content-type": "application/octet-stream" },
    corpoBase64: btoa("conteudo_binario_mock"),
  });

  const res = await promessaFetch;
  expect(res.status).toBe(200);
  const texto = await res.text();
  expect(texto).toBe("conteudo_binario_mock");
});

Deno.test("Worker HTTP - deve responder verificação de Android App Links e iOS Universal Links", async () => {
  const resAndroid = await worker.fetch(new Request("https://previa.arestaclimb.com/.well-known/assetlinks.json"));
  expect(resAndroid.status).toBe(200);

  const resIos = await worker.fetch(new Request("https://previa.arestaclimb.com/.well-known/apple-app-site-association"));
  expect(resIos.status).toBe(200);
});
