// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { expect } from "jsr:@std/expect";
import { GerenciadorSessao } from "../src/gerenciador_sessao.ts";
import worker, { gerenciador } from "../src/index.ts";
import { registrarInicioSessao, registrarFimSessao, obterQuantidadeSessoesAtivasBanco } from "../src/cliente_auditoria_supabase.ts";
import { validarTokenJwt, decodificarPayloadJwt, extrairJwtDeCabecalho } from "../src/validador_jwt.ts";

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

Deno.test("Worker HTTP - GET /ws deve validar posse de sessão e rejeitar usuário não autorizado", async () => {
  const jwtDono = criarJwtMock({
    sub: "usr_dono_123",
    email: "dono@arestaclimb.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const jwtInvasor = criarJwtMock({
    sub: "usr_invasor_999",
    email: "invasor@outro.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const mockEnv = {
    validarJwt: async (t: string | null) => {
      if (!t || t.includes("invalido")) return null;
      if (t === jwtDono) return { idUsuario: "usr_dono_123", email: "dono@arestaclimb.com" };
      if (t === jwtInvasor) return { idUsuario: "usr_invasor_999", email: "invasor@outro.com" };
      return null;
    },
  };

  // 1. Criar sessão para usr_dono_123
  const reqPost = new Request("https://previa.arestaclimb.com/sessoes", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwtDono}` },
  });
  const resPost = await worker.fetch(reqPost, mockEnv);
  const jsonPost = (await resPost.json()) as any;
  const codigo = jsonPost.codigo;

  // 2. Tentar conectar /ws para código inexistente -> 404
  const reqInexistente = new Request(`https://previa.arestaclimb.com/ws?sessao=inexiste9&token=${jwtDono}`, {
    headers: { Upgrade: "websocket" },
  });
  const resInexistente = await worker.fetch(reqInexistente, mockEnv);
  expect(resInexistente.status).toBe(404);

  // 3. Tentar conectar /ws sem token JWT -> 401
  const reqSemToken = new Request(`https://previa.arestaclimb.com/ws?sessao=${codigo}`, {
    headers: { Upgrade: "websocket" },
  });
  const resSemToken = await worker.fetch(reqSemToken, mockEnv);
  expect(resSemToken.status).toBe(401);

  // 4. Tentar conectar /ws com token de OUTRO usuário -> 403 Forbidden
  const reqInvasor = new Request(`https://previa.arestaclimb.com/ws?sessao=${codigo}&token=${jwtInvasor}`, {
    headers: { Upgrade: "websocket" },
  });
  const resInvasor = await worker.fetch(reqInvasor, mockEnv);
  expect(resInvasor.status).toBe(403);

  // 5. Conectar com o token do DONO -> 101 Switching Protocols
  const reqDono = new Request(`https://previa.arestaclimb.com/ws?sessao=${codigo}&token=${jwtDono}`, {
    headers: { Upgrade: "websocket" },
  });
  const resDono = await worker.fetch(reqDono, mockEnv);
  expect(resDono.status).toBe(101);

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
  expect(payload.tipo).toBe("requisicao_proxy");
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

// -----------------------------------------------------------------------------
// Testes de SessaoDurableObject e Roteamento Global
// -----------------------------------------------------------------------------

Deno.test("SessaoDurableObject - deve instanciar e processar requisições em sua própria instância", async () => {
  const { SessaoDurableObject } = await import("../src/index.ts");
  const doInstance = new SessaoDurableObject({}, {});

  expect(doInstance.gerenciador).toBeDefined();

  // Teste fetch no DO
  const req = new Request("https://previa.arestaclimb.com/health");
  const res = await doInstance.fetch(req);
  expect(res.status).toBe(200);

  // Testes de endpoints de registro global no DO
  const resAdd = await doInstance.fetch(new Request("https://previa.arestaclimb.com/__registro__/adicionar?codigo=abc12345&usuario=usr_1", { method: "POST" }));
  expect(resAdd.status).toBe(200);

  const resTotal1 = await doInstance.fetch(new Request("https://previa.arestaclimb.com/__registro__/total"));
  const dataTotal1 = await resTotal1.json();
  expect(dataTotal1.total).toBe(1);

  const resRem = await doInstance.fetch(new Request("https://previa.arestaclimb.com/__registro__/remover?codigo=abc12345", { method: "POST" }));
  expect(resRem.status).toBe(200);

  const resTotal2 = await doInstance.fetch(new Request("https://previa.arestaclimb.com/__registro__/total"));
  const dataTotal2 = await resTotal2.json();
  expect(dataTotal2.total).toBe(0);
});

Deno.test("Worker HTTP - deve rotear requisições via env.SESSAO_DO quando configurado", async () => {
  const jwt = criarJwtMock({
    sub: "usr_do_test",
    email: "do@aresta.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const chamadasStub: string[] = [];
  const fakeStub = {
    fetch: async (r: Request) => {
      chamadasStub.push(r.url);
      return new Response(JSON.stringify({ stub: "ok" }), { status: 200 });
    },
  };

  const mockEnv = {
    SESSAO_DO: {
      idFromName: (nome: string) => `id_${nome}`,
      get: (id: string) => fakeStub,
    },
  };

  // 1. POST /sessoes
  const reqPost = new Request("https://previa.arestaclimb.com/sessoes", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const resPost = await worker.fetch(reqPost, mockEnv);
  expect(resPost.status).toBe(200);
  expect(chamadasStub.length).toBe(1);
  expect(chamadasStub[0]).toContain("codigo_reservado=");

  // 2. GET /ws?sessao=k9x2p83a
  const reqWs = new Request(`https://previa.arestaclimb.com/ws?sessao=k9x2p83a&token=${jwt}`, {
    headers: { Upgrade: "websocket" },
  });
  const resWs = await worker.fetch(reqWs, mockEnv);
  expect(resWs.status).toBe(200);
  expect(chamadasStub.length).toBe(2);

  // 3. GET /k9x2p83a/indice.binarypb
  const reqProxy = new Request("https://previa.arestaclimb.com/k9x2p83a/indice.binarypb");
  const resProxy = await worker.fetch(reqProxy, mockEnv);
  expect(resProxy.status).toBe(200);
  expect(chamadasStub.length).toBe(3);
});

// -----------------------------------------------------------------------------
// Testes Adicionais de GerenciadorSessao (Expiração, Limpeza e Ouvintes)
// -----------------------------------------------------------------------------

Deno.test("GerenciadorSessao - deve expirar sessão por inatividade (> 30 minutos)", () => {
  const gm = new GerenciadorSessao();
  const socket = new FakeWebSocket();
  const sessao = gm.registrarSessao("temp1234", socket as any);

  expect(gm.obterSessao("temp1234")).toBeDefined();

  // Simula inatividade de 31 minutos
  sessao.ultimoAcessoEm = Date.now() - (31 * 60 * 1000);

  expect(gm.obterSessao("temp1234")).toBeUndefined();
  expect(socket.closed).toBe(true);
});

Deno.test("GerenciadorSessao - deve encerrar sessão anterior do mesmo usuário", () => {
  const gm = new GerenciadorSessao();
  const s1 = gm.criarSessao("usr_unico", "usr@aresta.com", {}, undefined, undefined, undefined, "cod_antigo");
  expect(gm.quantidadeSessoesAtivas()).toBe(1);

  const s2 = gm.criarSessao("usr_unico", "usr@aresta.com", {}, undefined, undefined, undefined, "cod_novo");
  expect(gm.quantidadeSessoesAtivas()).toBe(1);
  expect(gm.obterSessao("cod_antigo")).toBeUndefined();
  expect(gm.obterSessao("cod_novo")).toBeDefined();
});

Deno.test("GerenciadorSessao - removerOuvinte e falha no envio de evento devem remover ouvinte", () => {
  const gm = new GerenciadorSessao();
  const socketEditor = new FakeWebSocket();
  gm.registrarSessao("setor123", socketEditor as any);

  const ouvinteBom = new FakeWebSocket();
  const ouvinteQuebrado = new FakeWebSocket();
  ouvinteQuebrado.send = () => { throw new Error("Erro de rede"); };

  gm.adicionarOuvinte("setor123", ouvinteBom as any);
  gm.adicionarOuvinte("setor123", ouvinteQuebrado as any);

  const sessao = gm.obterSessao("setor123")!;
  expect(sessao.ouvintes.size).toBe(2);

  // Ao emitir evento, o ouvinteQuebrado deve falhar e ser removido
  gm.emitirEventoParaOuvintes("setor123", { recarregar: "setor1" });
  expect(ouvinteBom.sent.length).toBe(1);
  expect(sessao.ouvintes.size).toBe(1);

  // Remover ouvinte explicitamente
  gm.removerOuvinte("setor123", ouvinteBom as any);
  expect(sessao.ouvintes.size).toBe(0);
});

Deno.test("GerenciadorSessao - registrarRespostaProxy com id desconhecido deve retornar false", () => {
  const gm = new GerenciadorSessao();
  gm.registrarSessao("sess_proxy", new FakeWebSocket() as any);

  const ok = gm.registrarRespostaProxy("sess_proxy", {
    id: "id_inexistente",
    status: 200,
    cabecalhos: {},
  });
  expect(ok).toBe(false);

  expect(gm.registrarRespostaProxy("sessao_inexistente", {
    id: "qualquer",
    status: 200,
    cabecalhos: {},
  })).toBe(false);
});

// -----------------------------------------------------------------------------
// Testes Adicionais do Validador JWT
// -----------------------------------------------------------------------------

Deno.test("Validador JWT - deve rejeitar tokens malformados e expirados", async () => {
  expect(decodificarPayloadJwt("invalido")).toBeNull();
  expect(decodificarPayloadJwt("a.b")).toBeNull();
  expect(extrairJwtDeCabecalho(null)).toBe("");
  expect(extrairJwtDeCabecalho("")).toBe("");

  const jwtExpirado = criarJwtMock({
    sub: "usr_exp",
    email: "exp@aresta.com",
    exp: Math.floor(Date.now() / 1000) - 100,
  });

  const resExp = await validarTokenJwt(jwtExpirado);
  expect(resExp).toBeNull();

  // Com validador personalizado
  const resPers = await validarTokenJwt("qualquer", undefined, async () => {
    return { idUsuario: "custom_id", email: "custom@aresta.com" };
  });
  expect(resPers?.idUsuario).toBe("custom_id");
});

Deno.test("Validador JWT - deve tratar erros de rede ou retorno inválido do Supabase Auth", async () => {
  const jwtValido = criarJwtMock({
    sub: "usr_net",
    email: "net@aresta.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const mockAmbienteErro = {
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "mock_pub_key",
    executarFetch: async () => { throw new Error("Falha de rede"); },
  };

  const resErro = await validarTokenJwt(jwtValido, mockAmbienteErro as any);
  expect(resErro).toBeNull();

  const mockAmbienteCorpoInvalido = {
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "mock_pub_key",
    executarFetch: async () => new Response(JSON.stringify({}), { status: 200 }),
  };

  const resInvalido = await validarTokenJwt(jwtValido, mockAmbienteCorpoInvalido as any);
  expect(resInvalido).toBeNull();
});

// -----------------------------------------------------------------------------
// Testes Adicionais de Auditoria Supabase
// -----------------------------------------------------------------------------

Deno.test("Cliente Auditoria Supabase - cenários de erro e encerramento", async () => {
  // Sem credenciais
  const semCredInicio = await registrarInicioSessao({} as any, {});
  expect(semCredInicio).toBeNull();

  const semCredFim = await registrarFimSessao("id_123", {} as any, {});
  expect(semCredFim).toBe(false);

  // Com erro de fetch no início
  const erroFetchInicio = await registrarInicioSessao({
    usuarioId: "u1",
    usuarioEmail: "u1@aresta.com",
    codigo: "cod1",
    urlPrevia: "https://previa.arestaclimb.com/cod1",
  }, {
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    executarFetch: async () => { throw new Error("Erro"); },
  });
  expect(erroFetchInicio).toBeNull();

  // Com retorno 500 no encerramento por código
  const fim500 = await registrarFimSessao("cod1", {
    encerradoEm: new Date().toISOString(),
    duracaoSegundos: 10,
    motivoEncerramento: "normal",
  }, {
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    executarFetch: async () => new Response("Erro interno", { status: 500 }),
  });
  expect(fim500).toBe(false);

  // Consulta de quantidade de sessões ativas no banco
  const contagemNula = await obterQuantidadeSessoesAtivasBanco({});
  expect(contagemNula).toBeNull();

  const contagemHead = await obterQuantidadeSessoesAtivasBanco({
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    executarFetch: async () => new Response(null, {
      status: 200,
      headers: { "content-range": "0-2/3" },
    }),
  });
  expect(contagemHead).toBe(3);

  const contagemGet = await obterQuantidadeSessoesAtivasBanco({
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    executarFetch: async () => new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
      status: 200,
    }),
  });
  expect(contagemGet).toBe(2);
});

Deno.test("Worker HTTP - /health deve consultar Supabase quando memória do isolate estiver vazia", async () => {
  const gmVazio = new GerenciadorSessao();
  const req = new Request("https://previa.arestaclimb.com/health");
  const res = await worker.fetch(req, {
    gerenciadorPersonalizado: gmVazio,
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    executarFetch: async () => new Response(null, {
      status: 200,
      headers: { "content-range": "*/4" },
    }),
  } as any);

  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe("operacional");
  expect(json.sessoesAtivas).toBe(4);
});

// -----------------------------------------------------------------------------
// Testes de Edge Cases de Proxy e WebSocket no Worker
// -----------------------------------------------------------------------------

Deno.test("Worker HTTP - Proxy retorna 503 quando editor desktop não estiver conectado", async () => {
  const gm = new GerenciadorSessao();
  gm.criarSessao("usr_no_editor", "no_editor@aresta.com", {}, undefined, undefined, undefined, "noeditor");

  const req = new Request("https://previa.arestaclimb.com/noeditor/arquivo.png");
  const res = await worker.fetch(req, { gerenciadorPersonalizado: gm });
  expect(res.status).toBe(503);
});

Deno.test("Worker HTTP - /events exige upgrade de websocket e retorna 426 se for HTTP comum", async () => {
  const gm = new GerenciadorSessao();
  gm.registrarSessao("eventsess", new FakeWebSocket() as any);

  // Sem header upgrade
  const reqSemUpgrade = new Request("https://previa.arestaclimb.com/eventsess/events");
  const resSemUpgrade = await worker.fetch(reqSemUpgrade, { gerenciadorPersonalizado: gm });
  expect(resSemUpgrade.status).toBe(426);

  // Com sessão inexistente
  const reqInexistente = new Request("https://previa.arestaclimb.com/inexistente/events", {
    headers: { Upgrade: "websocket" },
  });
  const resInexistente = await worker.fetch(reqInexistente, { gerenciadorPersonalizado: gm });
  expect(resInexistente.status).toBe(404);

  // Com upgrade válido e sessão existente
  const reqValido = new Request("https://previa.arestaclimb.com/eventsess/events", {
    headers: { Upgrade: "websocket" },
  });
  const resValido = await worker.fetch(reqValido, { gerenciadorPersonalizado: gm });
  expect(resValido.status).toBe(101);

  // Com rota em português /eventos
  const reqEventos = new Request("https://previa.arestaclimb.com/eventsess/eventos", {
    headers: { Upgrade: "websocket" },
  });
  const resEventos = await worker.fetch(reqEventos, { gerenciadorPersonalizado: gm });
  expect(resEventos.status).toBe(101);
});

Deno.test("Worker HTTP - Tratamento completo de mensagens e eventos no túnel /ws", async () => {
  const jwt = criarJwtMock({
    sub: "usr_msg_test",
    email: "msg@aresta.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const gm = new GerenciadorSessao();
  gm.criarSessao("usr_msg_test", "msg@aresta.com", {}, undefined, undefined, undefined, "msg12345");

  const mockEnv = {
    validarJwt: async () => ({ idUsuario: "usr_msg_test", email: "msg@aresta.com" }),
    gerenciadorPersonalizado: gm,
  };

  const req = new Request(`https://previa.arestaclimb.com/ws?sessao=msg12345&token=${jwt}`, {
    headers: { Upgrade: "websocket" },
  });
  const res = await worker.fetch(req, mockEnv);
  expect(res.status).toBe(101);

  const sessao = gm.obterSessao("msg12345")!;
  const socketEditor = sessao.socketEditor as any;

  // 1. Mensagem de ping -> pong
  socketEditor.dispatchEvent(new MessageEvent("message", {
    data: JSON.stringify({ tipo: "ping" }),
  }));

  // 2. Mensagem de registro
  socketEditor.dispatchEvent(new MessageEvent("message", {
    data: JSON.stringify({ tipo: "registro", dados: { ipLocal: "10.0.0.5", portaLocal: 9000 } }),
  }));
  expect(sessao.metadados.ipLocal).toBe("10.0.0.5");

  // 3. Mensagem de evento para ouvintes
  const ouvinte = new FakeWebSocket();
  gm.adicionarOuvinte("msg12345", ouvinte as any);
  socketEditor.dispatchEvent(new MessageEvent("message", {
    data: JSON.stringify({ tipo: "evento", dados: { recarregar: "setor_xyz" } }),
  }));
  expect(ouvinte.sent.length).toBe(1);

  // 4. Mensagem de resposta_proxy
  let respostaRecebida = false;
  sessao.requisicoesPendentes.set("req_teste_1", () => { respostaRecebida = true; });
  socketEditor.dispatchEvent(new MessageEvent("message", {
    data: JSON.stringify({ tipo: "resposta_proxy", dados: { id: "req_teste_1", status: 200, cabecalhos: {} } }),
  }));
  expect(respostaRecebida).toBe(true);

  // 5. Mensagem de pong de volta do editor
  socketEditor.dispatchEvent(new MessageEvent("message", {
    data: JSON.stringify({ tipo: "pong" }),
  }));
  expect(sessao.ultimoAcessoEm).toBeGreaterThan(0);

  // 6. Fechamento no socket desvincula editor sem destruir imediatamente
  socketEditor.dispatchEvent(new CloseEvent("close"));
  expect(sessao.socketEditor).toBeUndefined();
  expect(gm.obterSessao("msg12345")).toBeDefined();
});

Deno.test("GerenciadorSessao - desconectarSocketEditor remove sessão após período de tolerância", async () => {
  const gm = new GerenciadorSessao();
  gm.registrarSessao("tolerancia1", new FakeWebSocket() as any);

  expect(gm.obterSessao("tolerancia1")).toBeDefined();
  gm.desconectarSocketEditor("tolerancia1", 50);

  // Antes de 50ms, a sessão ainda existe
  expect(gm.obterSessao("tolerancia1")).toBeDefined();

  // Aguarda expirar a tolerância
  await new Promise((r) => setTimeout(r, 80));
  expect(gm.obterSessao("tolerancia1")).toBeUndefined();
});

Deno.test("Worker HTTP - Aliases /sessions e /meta", async () => {
  const jwt = criarJwtMock({
    sub: "usr_alias",
    email: "alias@aresta.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const gm = new GerenciadorSessao();
  const mockEnv = {
    validarJwt: async () => ({ idUsuario: "usr_alias", email: "alias@aresta.com" }),
    gerenciadorPersonalizado: gm,
  };

  // POST /sessions
  const reqPost = new Request("https://previa.arestaclimb.com/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const resPost = await worker.fetch(reqPost, mockEnv);
  expect(resPost.status).toBe(201);
  const jsonPost = await resPost.json();

  // GET /<codigo>/meta
  const reqMeta = new Request(`https://previa.arestaclimb.com/${jsonPost.codigo}/meta`);
  const resMeta = await worker.fetch(reqMeta, mockEnv);
  expect(resMeta.status).toBe(200);
});

Deno.test("Worker HTTP - Erro de envio no socket durante proxy reverso deve retornar 502", async () => {
  const gm = new GerenciadorSessao();
  const socketQuebrado = {
    send: () => { throw new Error("Falha no socket"); },
    close: () => {},
  };
  gm.registrarSessao("quebrado1", socketQuebrado as any);

  const req = new Request("https://previa.arestaclimb.com/quebrado1/teste.bin");
  const res = await worker.fetch(req, { gerenciadorPersonalizado: gm });
  expect(res.status).toBe(502);
});



