import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { handleRequest } from "./handler.ts";

Deno.test("handleRequest - returns CORS headers for OPTIONS request", async () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const res = await handleRequest(req);
  
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest - returns 401 if API key is invalid", async () => {
  Deno.env.set("APP_API_KEY", "secret-key");
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");

  const req = new Request("http://localhost", { 
    method: "POST",
    headers: { "x-api-key": "wrong-key" }
  });
  const res = await handleRequest(req);
  
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");

  Deno.env.delete("APP_API_KEY");
  Deno.env.delete("DISCORD_WEBHOOK_URL");
});

Deno.test("handleRequest - returns 500 if DISCORD_WEBHOOK_URL is missing", async () => {
  // Ensure the env var is not set
  const originalEnv = Deno.env.get("DISCORD_WEBHOOK_URL");
  Deno.env.delete("DISCORD_WEBHOOK_URL");

  // Mock console.error to avoid polluting test output with expected errors
  const originalConsoleError = console.error;
  console.error = () => {};

  const formData = new FormData();
  formData.append("description", "Test");

  const req = new Request("http://localhost", { 
    method: "POST",
    body: formData
  });
  const res = await handleRequest(req);
  
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.includes("DISCORD_WEBHOOK_URL"), true);

  // Restore console.error and env
  console.error = originalConsoleError;
  if (originalEnv) Deno.env.set("DISCORD_WEBHOOK_URL", originalEnv);
});

Deno.test("handleRequest - successfully sends to Discord via multipart/form-data", async () => {
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  let fetchCalledWithUrl = "";
  let fetchCalledWithFormData: FormData | null = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("test-webhook")) {
      fetchCalledWithUrl = urlStr;
      fetchCalledWithFormData = options?.body as FormData;
      return new Response("ok", { status: 200 });
    }
    // Mock Supabase REST API
    return new Response(JSON.stringify([{}]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const formData = new FormData();
  formData.append("description", "This is a test feedback");
  formData.append("metadata", JSON.stringify({ os: "android", feedbackId: "uuid-1" }));

  Deno.env.set("SUPABASE_URL", "http://test-supabase");
  Deno.env.set("SUPABASE_SECRET_KEYS", "test-key");

  const req = new Request("http://localhost", { 
    method: "POST",
    body: formData
  });

  const res = await handleRequest(req);
  
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  
  assertEquals(fetchCalledWithUrl, "http://test-webhook");

  const actualFormData = fetchCalledWithFormData as any as FormData;
  const payloadJsonStr = actualFormData?.get("payload_json") as string;
  const payloadJson = JSON.parse(payloadJsonStr);

  assertEquals(payloadJson.embeds[0].fields[0].name, "Descrição");
  assertEquals(payloadJson.embeds[0].fields[0].value, "This is a test feedback");
  assertEquals(payloadJson.embeds[0].fields[1].name, "Metadados de Debug");
  assertEquals(payloadJson.embeds[0].fields[1].value.includes('"os": "android"'), true);

  // Testa se a thread_name foi criada corretamente (suporte a fóruns)
  assertEquals(typeof payloadJson.thread_name === "string", true);
  assertEquals((payloadJson.thread_name as string).includes("vDesconhecida"), true);
  assertEquals((payloadJson.thread_name as string).includes("This is a test feedback"), true);

  // Restore fetch
  globalThis.fetch = originalFetch;
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
});

Deno.test("handleRequest - detects duplicate UUID and returns 200 without calling Discord", async () => {
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");
  Deno.env.set("SUPABASE_URL", "http://test-supabase");
  Deno.env.set("SUPABASE_SECRET_KEYS", "test-key");

  const originalFetch = globalThis.fetch;
  let discordCalled = false;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("test-webhook")) {
      discordCalled = true;
      return new Response("ok", { status: 200 });
    }
    if (urlStr.includes("processed_feedbacks") && options?.method === "POST") {
      // Mock unique constraint violation (duplicate)
      return new Response(JSON.stringify({ code: "23505", message: "duplicate key value" }), { 
        status: 409, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const formData = new FormData();
  formData.append("metadata", JSON.stringify({ feedbackId: "duplicated-uuid" }));

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);
  
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.message, "Already processed");
  assertEquals(discordCalled, false); // Discord SHOULD NOT be called

  globalThis.fetch = originalFetch;
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
});

Deno.test("handleRequest - deletes old UUIDs automatically (TTL)", async () => {
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");
  Deno.env.set("SUPABASE_URL", "http://test-supabase");
  Deno.env.set("SUPABASE_SECRET_KEYS", "test-key");

  const originalFetch = globalThis.fetch;
  let deleteUrlHit = "";

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("test-webhook")) {
      return new Response("ok", { status: 200 });
    }
    if (urlStr.includes("processed_feedbacks") && options?.method === "DELETE") {
      deleteUrlHit = urlStr;
      return new Response("[]", { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const formData = new FormData();
  formData.append("metadata", JSON.stringify({ feedbackId: "new-uuid" }));

  const req = new Request("http://localhost", { method: "POST", body: formData });
  await handleRequest(req);
  
  // Verify that a DELETE request with 'created_at=lt.' was fired
  assertEquals(deleteUrlHit.includes("created_at=lt."), true);

  globalThis.fetch = originalFetch;
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
});

Deno.test("handleRequest - reporta erro 500 ao Sentry via RelatorSentryFake quando DISCORD_WEBHOOK_URL está ausente", async () => {
  const { RelatorSentryFake } = await import("../compartilhado/relator_sentry_fake.ts");
  const relatorFake = new RelatorSentryFake();

  Deno.env.delete("DISCORD_WEBHOOK_URL");
  Deno.env.set("SENTRY_DSN", "https://pub@o1.ingest.sentry.io/1");

  const formData = new FormData();
  formData.append("description", "Teste erro Sentry");

  const req = new Request("http://localhost/discord-feedback", {
    method: "POST",
    body: formData,
  });
  const res = await handleRequest(req, { relatorSentry: relatorFake });

  assertEquals(res.status, 500);
  assertEquals(relatorFake.eventos.length, 1);
  assertEquals(relatorFake.eventos[0].servico, "supabase-discord-feedback");
  assertEquals(relatorFake.eventos[0].mensagem.includes("DISCORD_WEBHOOK_URL"), true);

  Deno.env.delete("SENTRY_DSN");
});

