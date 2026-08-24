import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  handleRequest,
  setCustomJWKSet,
  resetRateLimits,
  checkRateLimit,
} from "./handler.ts";

Deno.test("app-feedback: retorna cabeçalhos CORS para requisição OPTIONS", async () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("app-feedback: retorna 403 se o token do App Check estiver ausente", async () => {
  resetRateLimits();
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");

  const formData = new FormData();
  formData.append("description", "Teste de feedback");

  const req = new Request("http://localhost", {
    method: "POST",
    body: formData,
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.includes("App Check"), true);

  Deno.env.delete("DISCORD_WEBHOOK_URL");
});

Deno.test("app-feedback: retorna 403 se o token do App Check for inválido", async () => {
  resetRateLimits();
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");

  const formData = new FormData();
  formData.append("description", "Teste de feedback");

  const req = new Request("http://localhost", {
    method: "POST",
    headers: { "X-Firebase-AppCheck": "token-invalido-forjado" },
    body: formData,
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 403);

  Deno.env.delete("DISCORD_WEBHOOK_URL");
});

Deno.test("app-feedback: valida com sucesso um JWT do App Check assinado", async () => {
  resetRateLimits();
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");
  Deno.env.set("SUPABASE_URL", "http://test-supabase");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  Deno.env.set("FIREBASE_PROJECT_NUMBER", "123456789");
  Deno.env.set("FIREBASE_PROJECT_ID", "test-project");

  // Cria par de chaves RSA para teste
  const keyPair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keyPair.publicKey);
  publicJwk.kid = "test-key-id";
  publicJwk.alg = "RS256";

  // Mock do JWKS local
  const customJWKS = async () => keyPair.publicKey;
  setCustomJWKSet(customJWKS);

  // Gera token válido assinado
  const validJwt = await new SignJWT({ sub: "app.escalada.croquis" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-id" })
    .setIssuer("https://firebaseappcheck.googleapis.com/123456789")
    .setAudience(["projects/123456789", "projects/test-project"])
    .setExpirationTime("1h")
    .sign(keyPair.privateKey);

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  let discordCalled = false;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("test-webhook")) {
      discordCalled = true;
      return new Response("ok", { status: 200 });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Feedback com App Check válido");
  formData.append("metadata", JSON.stringify({ os: "android", feedbackId: "test-valid-uuid" }));

  const req = new Request("http://localhost", {
    method: "POST",
    headers: { "X-Firebase-AppCheck": validJwt },
    body: formData,
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 200);
  assertEquals(discordCalled, true);

  const body = await res.json();
  assertEquals(body.success, true);

  globalThis.fetch = originalFetch;
  Deno.env.delete("DISCORD_WEBHOOK_URL");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("FIREBASE_PROJECT_NUMBER");
  Deno.env.delete("FIREBASE_PROJECT_ID");
});

Deno.test("app-feedback: aplica Rate Limiting de 5 requisições por minuto por IP", async () => {
  resetRateLimits();
  const testIp = "192.168.1.100";
  const now = Date.now();

  // As primeiras 5 devem ser permitidas
  for (let i = 0; i < 5; i++) {
    const check = checkRateLimit(testIp, 5, 60000, now + i * 100);
    assertEquals(check.allowed, true);
  }

  // A 6ª tentativa dentro da mesma janela deve ser bloqueada
  const blockedCheck = checkRateLimit(testIp, 5, 60000, now + 1000);
  assertEquals(blockedCheck.allowed, false);
  assertEquals(blockedCheck.retryAfterSeconds > 0, true);

  // Requisição HTTP real com IP bloqueado
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");

  const formData = new FormData();
  formData.append("description", "Teste flood");

  const req = new Request("http://localhost", {
    method: "POST",
    headers: { "cf-connecting-ip": testIp },
    body: formData,
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 429);
  assertEquals(res.headers.has("Retry-After"), true);

  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
  Deno.env.delete("DISCORD_WEBHOOK_URL");
});

Deno.test("app-feedback: realiza retentativa automática se o Discord responder 429", async () => {
  resetRateLimits();
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");
  Deno.env.set("SUPABASE_URL", "http://test-supabase");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("test-webhook")) {
      attempts++;
      if (attempts === 1) {
        // Primeira tentativa retorna 429 com Retry-After curto
        return new Response(JSON.stringify({ message: "You are being rate limited" }), {
          status: 429,
          headers: { "Retry-After": "0.1", "Content-Type": "application/json" },
        });
      }
      // Segunda tentativa tem sucesso
      return new Response("ok", { status: 200 });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste de retry 429");

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(attempts, 2);

  globalThis.fetch = originalFetch;
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
  Deno.env.delete("DISCORD_WEBHOOK_URL");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
});

Deno.test("app-feedback: retorna 503 se o Discord falhar e remove trava de idempotência", async () => {
  resetRateLimits();
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");
  Deno.env.set("SUPABASE_URL", "http://test-supabase");
  Deno.env.set("SUPABASE_SECRET_KEYS", "test-key");

  const originalFetch = globalThis.fetch;
  let rollbackExecuted = false;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("test-webhook")) {
      return new Response("Discord server error", { status: 500 });
    }
    if (urlStr.includes("processed_feedbacks") && options?.method === "DELETE") {
      rollbackExecuted = true;
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste falha discord");
  formData.append("metadata", JSON.stringify({ feedbackId: "rollback-uuid" }));

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 503);
  assertEquals(rollbackExecuted, true);

  globalThis.fetch = originalFetch;
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
  Deno.env.delete("DISCORD_WEBHOOK_URL");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
});
