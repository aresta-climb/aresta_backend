import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  handleRequest,
  setCustomJWKSet,
  setCustomTokenProvider,
  resetRateLimits,
  checkRateLimit,
  extrairProjectRef,
} from "./handler.ts";
import { obterTokenArestaClimbBot } from "../compartilhado/cliente_github_bot.ts";

Deno.test("app-feedback: extrairProjectRef extrai a referência do projeto estritamente a partir da SUPABASE_URL", () => {
  assertEquals(extrairProjectRef("https://abcdefghijkl.supabase.co"), "abcdefghijkl");
  assertEquals(extrairProjectRef("https://aresta-prod-xyz.supabase.co"), "aresta-prod-xyz");
  assertEquals(extrairProjectRef(""), "default");
});

Deno.test("app-feedback: retorna cabeçalhos CORS para requisição OPTIONS", async () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("app-feedback: retorna 403 se o token do App Check estiver ausente", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("test-gh-token"));

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

  setCustomTokenProvider(null);
});

Deno.test("app-feedback: retorna 403 se o token do App Check for inválido", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("test-gh-token"));

  const formData = new FormData();
  formData.append("description", "Teste de feedback");

  const req = new Request("http://localhost", {
    method: "POST",
    headers: { "X-Firebase-AppCheck": "token-invalido-forjado" },
    body: formData,
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 403);

  setCustomTokenProvider(null);
});

Deno.test("app-feedback: falha com 500 se as variáveis ARESTA_CLIMB_BOT_GITHUB_APP_* estiverem ausentes", async () => {
  resetRateLimits();
  setCustomTokenProvider(null);
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");
  Deno.env.delete("ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID");
  Deno.env.delete("ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY");
  Deno.env.delete("ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID");

  const formData = new FormData();
  formData.append("description", "Teste sem token");

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.includes("Aresta Climb Bot"), true);

  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: despacha issue para a API do GitHub com labels e título corretos para Croqui", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-secret-token"));
  Deno.env.set("SUPABASE_URL", "https://aresta-prod-xyz.supabase.co");
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ service_role: "test-key" }));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let githubPayload: any = null;
  let githubHeaders: Headers | null = null;
  let supabaseDiagnosticosPayload: any = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com/repos/aresta-climb/aresta_db/issues")) {
      githubPayload = JSON.parse(options?.body as string);
      githubHeaders = new Headers(options?.headers);
      return new Response(
        JSON.stringify({ html_url: "https://github.com/aresta-climb/aresta_db/issues/42" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("feedback_diagnosticos")) {
      supabaseDiagnosticosPayload = JSON.parse(options?.body as string);
      return new Response(JSON.stringify([{}]), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Via 3 com chapeleta frouxa");
  formData.append(
    "metadata",
    JSON.stringify({
      feedbackId: "croqui-uuid-123",
      tipo_feedback: "croqui",
      croqui_id: "br_mg_igarape_pedra_grande",
      os: "android",
      appVersion: "1.2.0",
      deviceModel: "Samsung Galaxy S22",
      appInstanceId: "firebase-secret-id",
    })
  );

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  const responseBody = await res.json();
  assertEquals(responseBody.success, true);
  assertEquals(responseBody.issue_url, "https://github.com/aresta-climb/aresta_db/issues/42");

  // Validação do payload enviado ao GitHub
  assertEquals(githubPayload !== null, true);
  assertEquals(githubPayload.title.startsWith("[Croqui | br_mg_igarape_pedra_grande]"), true);
  assertEquals(githubPayload.labels.includes("feedback:croqui"), true);
  assertEquals(githubPayload.labels.includes("so:android"), true);
  assertEquals(githubPayload.labels.includes("pico:br_mg_igarape_pedra_grande"), true);

  // Validação de privacidade: dados sensíveis NÃO devem constar no corpo da issue do GitHub
  assertEquals(githubPayload.body.includes("firebase-secret-id"), false);
  assertEquals(githubPayload.body.includes("Samsung Galaxy S22"), false);

  // Link restrito para o Supabase Dashboard deve constar no corpo usando o ref extraído de SUPABASE_URL
  assertEquals(
    githubPayload.body.includes(
      "https://supabase.com/dashboard/project/aresta-prod-xyz/editor/feedback_diagnosticos?filter=id%3Deq%3Dcroqui-uuid-123"
    ),
    true
  );

  // Validação da persistência protegida no Supabase
  assertEquals(supabaseDiagnosticosPayload !== null, true);
  assertEquals(supabaseDiagnosticosPayload.id, "croqui-uuid-123");
  assertEquals(supabaseDiagnosticosPayload.tipo_feedback, "croqui");
  assertEquals(supabaseDiagnosticosPayload.croqui_id, "br_mg_igarape_pedra_grande");
  assertEquals(supabaseDiagnosticosPayload.app_instance_id, "firebase-secret-id");

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: despacha issue para tela neutra com categoria app", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-secret-token"));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let githubPayload: any = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com")) {
      githubPayload = JSON.parse(options?.body as string);
      return new Response(
        JSON.stringify({ html_url: "https://github.com/aresta-climb/aresta_db/issues/43" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Travamento na tela de Ajustes");
  formData.append(
    "metadata",
    JSON.stringify({
      feedbackId: "app-uuid-999",
      tipo_feedback: "app",
      os: "ios",
      appVersion: "1.2.0",
    })
  );

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(githubPayload.title.startsWith("[App]"), true);
  assertEquals(githubPayload.labels.includes("feedback:app"), true);
  assertEquals(githubPayload.labels.includes("so:ios"), true);
  // Não deve conter label de pico
  assertEquals(githubPayload.labels.some((l: string) => l.startsWith("pico:")), false);

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: realiza retentativa automática se a API do GitHub responder 429", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-token"));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com")) {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 429,
          headers: { "Retry-After": "0.1", "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ html_url: "https://github.com/issue/1" }), { status: 201 });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste de retry 429 no GitHub");

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(attempts, 2);

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: retorna 503 se o GitHub falhar e remove trava de idempotência", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-token"));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");
  Deno.env.set("SUPABASE_URL", "https://test-supabase.supabase.co");
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ service_role: "test-key" }));

  const originalFetch = globalThis.fetch;
  let rollbackExecuted = false;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com")) {
      return new Response("GitHub server error", { status: 500 });
    }
    if (urlStr.includes("processed_feedbacks") && options?.method === "DELETE") {
      rollbackExecuted = true;
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste falha github");
  formData.append("metadata", JSON.stringify({ feedbackId: "rollback-uuid-gh" }));

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 503);
  assertEquals(rollbackExecuted, true);

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
});

Deno.test("app-feedback: faz upload de screenshot, indice_file e croqui_file para Supabase Storage e anexa links no corpo da issue e diagnosticos", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-secret-token"));
  Deno.env.set("SUPABASE_URL", "https://aresta-prod-xyz.supabase.co");
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ service_role: "test-key" }));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let githubPayload: any = null;
  let supabaseDiagnosticosPayload: any = null;
  const storageUploads: string[] = [];

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com/repos/aresta-climb/aresta_db/issues")) {
      githubPayload = JSON.parse(options?.body as string);
      return new Response(
        JSON.stringify({ html_url: "https://github.com/aresta-climb/aresta_db/issues/45" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("/storage/v1/object/feedback_anexos/")) {
      storageUploads.push(urlStr);
      return new Response(JSON.stringify({ Key: "feedback_anexos/uploaded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("feedback_diagnosticos")) {
      supabaseDiagnosticosPayload = JSON.parse(options?.body as string);
      return new Response(JSON.stringify([{}]), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Croqui com agarras marcadas incorretamente");
  formData.append(
    "metadata",
    JSON.stringify({
      feedbackId: "anexos-uuid-777",
      tipo_feedback: "croqui",
      croqui_id: "br_mg_sabara_pedra_rachada",
      os: "android",
      appVersion: "0.5.2-dev",
      croqui_status: "INTEGRO",
      thumbnail_status: "INTEGRO",
      indice_sha256: "hash-8e7ec9",
    })
  );

  const screenshotFile = new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", { type: "image/png" });
  const indiceFile = new File([new Uint8Array([1, 2, 3])], "indice.binarypb", { type: "application/octet-stream" });
  const croquiFile = new File([new Uint8Array([4, 5, 6])], "compilado.binarypb", { type: "application/octet-stream" });

  formData.append("screenshot", screenshotFile);
  formData.append("indice_file", indiceFile);
  formData.append("croqui_file", croquiFile);

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  const resJson = await res.json();
  assertEquals(resJson.success, true);
  assertEquals(resJson.issue_url, "https://github.com/aresta-climb/aresta_db/issues/45");

  // Verifica que os 3 uploads foram realizados para o Supabase Storage
  assertEquals(storageUploads.length, 3);
  assertEquals(storageUploads.some((u) => u.includes("anexos-uuid-777/screenshot.png")), true);
  assertEquals(storageUploads.some((u) => u.includes("anexos-uuid-777/indice.binarypb")), true);
  assertEquals(storageUploads.some((u) => u.includes("anexos-uuid-777/compilado.binarypb")), true);

  // Valida que o corpo da issue no GitHub contém o preview da imagem e os links diretos para download
  assertEquals(githubPayload !== null, true);
  assertEquals(githubPayload.body.includes("### Captura de Tela"), true);
  assertEquals(
    githubPayload.body.includes(
      "https://aresta-prod-xyz.supabase.co/storage/v1/object/public/feedback_anexos/anexos-uuid-777/screenshot.png"
    ),
    true
  );
  assertEquals(githubPayload.body.includes("### Arquivos de Auditoria (Download Direto)"), true);
  assertEquals(
    githubPayload.body.includes(
      "[📥 Baixar indice.binarypb](https://aresta-prod-xyz.supabase.co/storage/v1/object/public/feedback_anexos/anexos-uuid-777/indice.binarypb)"
    ),
    true
  );
  assertEquals(
    githubPayload.body.includes(
      "[📥 Baixar compilado.binarypb](https://aresta-prod-xyz.supabase.co/storage/v1/object/public/feedback_anexos/anexos-uuid-777/compilado.binarypb)"
    ),
    true
  );

  // Valida que o payload de diagnóstico no Supabase salvou as URLs
  assertEquals(supabaseDiagnosticosPayload !== null, true);
  assertEquals(
    supabaseDiagnosticosPayload.screenshot_url,
    "https://aresta-prod-xyz.supabase.co/storage/v1/object/public/feedback_anexos/anexos-uuid-777/screenshot.png"
  );
  assertEquals(
    supabaseDiagnosticosPayload.indice_url,
    "https://aresta-prod-xyz.supabase.co/storage/v1/object/public/feedback_anexos/anexos-uuid-777/indice.binarypb"
  );
  assertEquals(
    supabaseDiagnosticosPayload.croqui_url,
    "https://aresta-prod-xyz.supabase.co/storage/v1/object/public/feedback_anexos/anexos-uuid-777/compilado.binarypb"
  );
  assertEquals(
    supabaseDiagnosticosPayload.payload_completo.screenshot_url,
    "https://aresta-prod-xyz.supabase.co/storage/v1/object/public/feedback_anexos/anexos-uuid-777/screenshot.png"
  );

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

