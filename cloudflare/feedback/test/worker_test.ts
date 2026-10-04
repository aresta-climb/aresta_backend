// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { processarRequisicao, cabecalhosCors } from "../src/index.ts";

Deno.test("feedback-gateway: responde a OPTIONS com status 204 e cabecalhos CORS", async () => {
  const req = new Request("https://feedback.arestaclimb.com/anexos/uuid/screenshot.png", {
    method: "OPTIONS",
  });
  const res = await processarRequisicao(req);

  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("feedback-gateway: rejeita metodos POST, PUT e DELETE com 405", async () => {
  for (const metodo of ["POST", "PUT", "DELETE"]) {
    const req = new Request("https://feedback.arestaclimb.com/health", { method: metodo });
    const res = await processarRequisicao(req);

    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET, HEAD, OPTIONS");
  }
});

Deno.test("feedback-gateway: rota de healthcheck (/ e /health) retorna 200 operacional", async () => {
  for (const path of ["/", "/health"]) {
    const req = new Request(`https://feedback.arestaclimb.com${path}`);
    const res = await processarRequisicao(req);

    assertEquals(res.status, 200);
    const texto = await res.text();
    assertEquals(texto.includes("operacional"), true);
  }
});

Deno.test("feedback-gateway: redireciona /diagnostico/:id e /diagnosticos/:id com 307 para o Supabase Dashboard", async () => {
  const uuidTeste = "e70d7e05-c998-4100-9091-cb5275a34833";

  for (const rota of [`/diagnostico/${uuidTeste}`, `/diagnosticos/${uuidTeste}`]) {
    const req = new Request(`https://feedback.arestaclimb.com${rota}`);
    const res = await processarRequisicao(req);

    assertEquals(res.status, 307);
    const location = res.headers.get("Location");
    assertEquals(
      location,
      `https://supabase.com/dashboard/project/yzkhiaoqtxvvcyyuwmqg/editor/42715?filter=id%3Aeq%3A${uuidTeste}`
    );
  }
});

Deno.test("feedback-gateway: redireciona respeitando SUPABASE_DASHBOARD_URL customizado", async () => {
  const req = new Request("https://feedback.arestaclimb.com/diagnostico/uuid-custom");
  const res = await processarRequisicao(req, {
    SUPABASE_DASHBOARD_URL: "https://custom-admin.arestaclimb.com/feedback",
  });

  assertEquals(res.status, 307);
  assertEquals(
    res.headers.get("Location"),
    "https://custom-admin.arestaclimb.com/feedback?filter=id%3Aeq%3Auuid-custom"
  );
});

Deno.test("feedback-gateway: repassa anexo com streaming, CORS e cache imutavel", async () => {
  const originalFetch = globalThis.fetch;
  let urlChamada = "";
  let headerIfNoneMatchEnviado = "";

  globalThis.fetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    urlChamada = url.toString();
    const headers = new Headers(init?.headers);
    headerIfNoneMatchEnviado = headers.get("if-none-match") || "";

    return Promise.resolve(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "ETag": '"hash-12345"',
        },
      })
    );
  };

  const req = new Request(
    "https://feedback.arestaclimb.com/anexos/uuid-123/screenshot.png",
    {
      headers: { "if-none-match": '"hash-12345"' },
    }
  );
  const res = await processarRequisicao(req);

  assertEquals(res.status, 200);
  assertEquals(
    urlChamada,
    "https://yzkhiaoqtxvvcyyuwmqg.supabase.co/storage/v1/object/public/feedback_anexos/uuid-123/screenshot.png"
  );
  assertEquals(headerIfNoneMatchEnviado, '"hash-12345"');
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    res.headers.get("Cache-Control"),
    "public, max-age=31536000, s-maxage=31536000, immutable"
  );
  assertEquals(res.headers.get("Content-Type"), "image/png");

  const bytes = new Uint8Array(await res.arrayBuffer());
  assertEquals(bytes[0], 137);

  globalThis.fetch = originalFetch;
});

Deno.test("feedback-gateway: retorna resposta direto da Cache API sem consultar a origem (Cache HIT)", async () => {
  let fetchChamado = false;
  const originalFetch = globalThis.fetch;
  const descOriginal = Object.getOwnPropertyDescriptor(globalThis, "caches")!;

  globalThis.fetch = (): Promise<Response> => {
    fetchChamado = true;
    return Promise.resolve(new Response("Nao deveria chamar"));
  };

  const respostaEmCache = new Response("conteudo-em-cache", {
    status: 200,
    headers: { "Content-Type": "text/plain", "CF-Cache-Status": "HIT" },
  });

  const cacheFake = {
    match: (_request: Request) => Promise.resolve(respostaEmCache),
    put: (_request: Request, _response: Response) => Promise.resolve(),
  };

  Object.defineProperty(globalThis, "caches", {
    value: { default: cacheFake },
    configurable: true,
  });

  try {
    const req = new Request("https://feedback.arestaclimb.com/anexos/uuid-hit/arquivo.txt");
    const res = await processarRequisicao(req);

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("CF-Cache-Status"), "HIT");
    assertEquals(await res.text(), "conteudo-em-cache");
    assertEquals(fetchChamado, false);
  } finally {
    Object.defineProperty(globalThis, "caches", descOriginal);
    globalThis.fetch = originalFetch;
  }
});

Deno.test("feedback-gateway: grava no Edge Cache via ctx.waitUntil se nao estiver em cache (Cache MISS)", async () => {
  const originalFetch = globalThis.fetch;
  const descOriginal = Object.getOwnPropertyDescriptor(globalThis, "caches")!;

  globalThis.fetch = (): Promise<Response> => {
    return Promise.resolve(
      new Response("dados-novos-da-origem", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );
  };

  let cachePutChamado = false;
  let waitUntilChamado = false;

  const cacheFake = {
    match: (_request: Request) => Promise.resolve(null),
    put: (_request: Request, _response: Response) => {
      cachePutChamado = true;
      return Promise.resolve();
    },
  };

  Object.defineProperty(globalThis, "caches", {
    value: { default: cacheFake },
    configurable: true,
  });

  const ctxFake = {
    waitUntil: (promessa: Promise<unknown>) => {
      waitUntilChamado = true;
      promessa.catch(() => {});
    },
  };

  try {
    const req = new Request("https://feedback.arestaclimb.com/anexos/uuid-miss/arquivo.txt");
    const res = await processarRequisicao(req, {}, ctxFake);

    assertEquals(res.status, 200);
    assertEquals(await res.text(), "dados-novos-da-origem");
    assertEquals(waitUntilChamado, true);
    assertEquals(cachePutChamado, true);
  } finally {
    Object.defineProperty(globalThis, "caches", descOriginal);
    globalThis.fetch = originalFetch;
  }
});

Deno.test("feedback-gateway: retorna 502 se o fetch para o storage de origem falhar", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (): Promise<Response> => {
    return Promise.reject(new Error("Conexao recusada na origem"));
  };

  const req = new Request("https://feedback.arestaclimb.com/anexos/uuid-123/screenshot.png");
  const res = await processarRequisicao(req);

  assertEquals(res.status, 502);
  const texto = await res.text();
  assertEquals(texto.includes("Erro ao buscar anexo no storage de origem"), true);

  globalThis.fetch = originalFetch;
});

Deno.test("feedback-gateway: retorna 404 para rotas desconhecidas", async () => {
  const req = new Request("https://feedback.arestaclimb.com/rota-desconhecida");
  const res = await processarRequisicao(req);

  assertEquals(res.status, 404);
});
