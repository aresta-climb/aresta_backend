import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  handleRequest,
  setCustomJWKSet,
  setCustomTokenProvider,
  resetRateLimits,
  checkRateLimit,
  extrairProjectRef,
  sanitizarLabel,
  formatarBreadcrumbs,
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
      modo_acesso_croqui: "online",
      submittedAt: "05 de outubro de 2026 às 00:00:00 (GMT-3)",
      submittedAtTimestamp: "2026-10-05T00:00:00.000-03:00",
      navigationTree: "Início -> Pico (br_mg_igarape_pedra_grande) -> Setor (Setor Central)",
      os: "android",
      osVersion: "13",
      appVersion: "1.2.0",
      deviceModel: "Samsung Galaxy S22",
      screenSize: "392x825",
      deviceOrientation: "portrait",
      isDarkMode: "true",
      connectivity: "mobile",
      appInstanceId: "firebase-secret-id",
      breadcrumbs: [
        {
          timestamp: "2026-10-05T00:00:00.000-03:00",
          evento: "acao_croqui",
          parametros: { id_croqui: "br_mg_igarape_pedra_grande", acao: "abrir_croqui" },
        },
      ],
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
  assertEquals(githubPayload.labels.includes("modo:online"), true);

  // Validação do corpo da issue informando dados gerais e técnicos não sigilosos
  assertEquals(
    githubPayload.body.includes("- **Data de Envio:** 05 de outubro de 2026 às 00:00:00 (GMT-3) (`2026-10-05T00:00:00.000-03:00`)"),
    true
  );
  assertEquals(githubPayload.body.includes("- **Modo de Acesso:** 🌐 Online (Sob Demanda)"), true);
  assertEquals(
    githubPayload.body.includes("- **Árvore de Navegação:** `Início -> Pico (br_mg_igarape_pedra_grande) -> Setor (Setor Central)`"),
    true
  );
  assertEquals(githubPayload.body.includes("- **Plataforma:** `android (Versão 13)`"), true);
  assertEquals(
    githubPayload.body.includes("- **Interface:** Resolução: `392x825` | Orientação: `portrait` | Modo Escuro: Sim"),
    true
  );
  assertEquals(githubPayload.body.includes("- **Conectividade:** `mobile`"), true);

  // Validação de privacidade: dados sensíveis / restritos NÃO devem constar no corpo da issue do GitHub
  assertEquals(githubPayload.body.includes("firebase-secret-id"), false);
  assertEquals(githubPayload.body.includes("Samsung Galaxy S22"), false);
  assertEquals(githubPayload.body.includes("breadcrumbs"), false);

  // Link restrito para o Supabase Dashboard deve constar no corpo usando o gateway canônico
  assertEquals(
    githubPayload.body.includes(
      "https://feedback.arestaclimb.com/diagnostico/croqui-uuid-123"
    ),
    true
  );

  // Validação da persistência protegida no Supabase
  assertEquals(supabaseDiagnosticosPayload !== null, true);
  assertEquals(supabaseDiagnosticosPayload.id, "croqui-uuid-123");
  assertEquals(supabaseDiagnosticosPayload.tipo_feedback, "croqui");
  assertEquals(supabaseDiagnosticosPayload.croqui_id, "br_mg_igarape_pedra_grande");
  assertEquals(supabaseDiagnosticosPayload.modo_acesso_croqui, "online");
  assertEquals(supabaseDiagnosticosPayload.submitted_at, "05 de outubro de 2026 às 00:00:00 (GMT-3)");
  assertEquals(supabaseDiagnosticosPayload.submitted_at_timestamp, "2026-10-05T00:00:00.000-03:00");
  assertEquals(supabaseDiagnosticosPayload.navigation_tree, "Início -> Pico (br_mg_igarape_pedra_grande) -> Setor (Setor Central)");
  assertEquals(supabaseDiagnosticosPayload.device_model, "Samsung Galaxy S22");
  assertEquals(supabaseDiagnosticosPayload.os, "android");
  assertEquals(supabaseDiagnosticosPayload.os_version, "13");
  assertEquals(supabaseDiagnosticosPayload.screen_size, "392x825");
  assertEquals(supabaseDiagnosticosPayload.device_orientation, "portrait");
  assertEquals(supabaseDiagnosticosPayload.is_dark_mode, "true");
  assertEquals(typeof supabaseDiagnosticosPayload.breadcrumbs, "string");
  assertEquals(
    supabaseDiagnosticosPayload.breadcrumbs.includes("[00:00:00] acao_croqui (id_croqui: br_mg_igarape_pedra_grande, acao: abrir_croqui)"),
    true
  );
  assertEquals(Array.isArray(supabaseDiagnosticosPayload.payload_completo.breadcrumbs), true);

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
  const storageContentTypes: Record<string, string> = {};

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
      const ct = new Headers(options?.headers).get("content-type");
      if (ct) {
        storageContentTypes[urlStr] = ct;
      }
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

  // Simula cliente enviando application/octet-stream para o screenshot
  const screenshotFile = new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", { type: "application/octet-stream" });
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
  const screenshotKey = storageUploads.find((u) => u.includes("anexos-uuid-777/screenshot.png"));
  assertEquals(screenshotKey !== undefined, true);
  assertEquals(storageContentTypes[screenshotKey!], "image/png");
  assertEquals(storageUploads.some((u) => u.includes("anexos-uuid-777/indice.binarypb")), true);
  assertEquals(storageUploads.some((u) => u.includes("anexos-uuid-777/compilado.binarypb")), true);

  // Valida que o corpo da issue no GitHub contém o preview da imagem e os links diretos para download via gateway canônico
  assertEquals(githubPayload !== null, true);
  assertEquals(githubPayload.body.includes("### Captura de Tela"), true);
  assertEquals(
    githubPayload.body.includes(
      "https://feedback.arestaclimb.com/anexos/anexos-uuid-777/screenshot.png"
    ),
    true
  );
  assertEquals(githubPayload.body.includes("### Arquivos de Auditoria (Download Direto)"), true);
  assertEquals(
    githubPayload.body.includes(
      "[📥 Baixar indice.binarypb](https://feedback.arestaclimb.com/anexos/anexos-uuid-777/indice.binarypb)"
    ),
    true
  );
  assertEquals(
    githubPayload.body.includes(
      "[📥 Baixar compilado.binarypb](https://feedback.arestaclimb.com/anexos/anexos-uuid-777/compilado.binarypb)"
    ),
    true
  );

  // Valida que o payload de diagnóstico no Supabase salvou as URLs
  assertEquals(supabaseDiagnosticosPayload !== null, true);
  assertEquals(
    supabaseDiagnosticosPayload.screenshot_url,
    "https://feedback.arestaclimb.com/anexos/anexos-uuid-777/screenshot.png"
  );
  assertEquals(
    supabaseDiagnosticosPayload.indice_url,
    "https://feedback.arestaclimb.com/anexos/anexos-uuid-777/indice.binarypb"
  );
  assertEquals(
    supabaseDiagnosticosPayload.croqui_url,
    "https://feedback.arestaclimb.com/anexos/anexos-uuid-777/compilado.binarypb"
  );

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: em produção (yzkhiaoqtxvvcyyuwmqg), utiliza fallback direto para 42715 quando FEEDBACK_PUBLIC_BASE_URL for vazio", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-secret-token"));
  Deno.env.set("SUPABASE_URL", "https://yzkhiaoqtxvvcyyuwmqg.supabase.co");
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ service_role: "test-key" }));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");
  Deno.env.set("FEEDBACK_PUBLIC_BASE_URL", "");

  const originalFetch = globalThis.fetch;
  let githubPayload: any = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com/repos/aresta-climb/aresta_db/issues")) {
      githubPayload = JSON.parse(options?.body as string);
      return new Response(
        JSON.stringify({ html_url: "https://github.com/aresta-climb/aresta_db/issues/46" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste em produção com fallback direto");
  formData.append("metadata", JSON.stringify({ feedbackId: "prod-uuid-123" }));

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(githubPayload !== null, true);
  assertEquals(
    githubPayload.body.includes(
      "https://supabase.com/dashboard/project/yzkhiaoqtxvvcyyuwmqg/editor/42715?filter=id%3Aeq%3Aprod-uuid-123"
    ),
    true
  );

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
  Deno.env.delete("FEEDBACK_PUBLIC_BASE_URL");
});

Deno.test("app-feedback: faz upload de screenshot WebP com content-type image/webp e anexa link .webp no GitHub", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-secret-token"));
  Deno.env.set("SUPABASE_URL", "https://aresta-prod-xyz.supabase.co");
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ service_role: "test-key" }));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let githubPayload: any = null;
  const storageUploads: string[] = [];
  const storageContentTypes: Record<string, string> = {};

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com/repos/aresta-climb/aresta_db/issues")) {
      githubPayload = JSON.parse(options?.body as string);
      return new Response(
        JSON.stringify({ html_url: "https://github.com/aresta-climb/aresta_db/issues/47" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("/storage/v1/object/feedback_anexos/")) {
      storageUploads.push(urlStr);
      const ct = new Headers(options?.headers).get("content-type");
      if (ct) {
        storageContentTypes[urlStr] = ct;
      }
      return new Response(JSON.stringify({ Key: "feedback_anexos/uploaded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("feedback_diagnosticos")) {
      return new Response(JSON.stringify([{}]), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste com imagem WebP");
  formData.append(
    "metadata",
    JSON.stringify({
      feedbackId: "webp-uuid-888",
      tipo_feedback: "app",
      os: "android",
      appVersion: "0.5.2-dev",
    })
  );

  const screenshotWebpFile = new File([new Uint8Array([82, 73, 70, 70])], "screenshot.webp", { type: "image/webp" });
  formData.append("screenshot", screenshotWebpFile);

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);

  // Verifica que o arquivo foi salvo com extensão .webp e content-type image/webp
  const screenshotKey = storageUploads.find((u) => u.includes("webp-uuid-888/screenshot.webp"));
  assertEquals(screenshotKey !== undefined, true);
  assertEquals(storageContentTypes[screenshotKey!], "image/webp");

  // Verifica que o corpo da issue contém o link screenshot.webp
  assertEquals(githubPayload !== null, true);
  assertEquals(
    githubPayload.body.includes(
      "https://feedback.arestaclimb.com/anexos/webp-uuid-888/screenshot.webp"
    ),
    true
  );

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: sanitizarLabel trunca labels com mais de 50 caracteres e limpa vírgulas", () => {
  const labelLonga = "pico:br_mg_santa_luzia_morro_do_carrapato_setor_covide"; // 54 caracteres
  const resultado = sanitizarLabel(labelLonga);
  assertEquals(resultado !== null, true);
  assertEquals(resultado!.length, 50);
  assertEquals(resultado, "pico:br_mg_santa_luzia_morro_do_carrapato_setor_co");

  assertEquals(sanitizarLabel("label,com,virgula"), "labelcomvirgula");
  assertEquals(sanitizarLabel(""), null);
  assertEquals(sanitizarLabel("   "), null);
});

Deno.test("app-feedback: despacha issue para croqui com id longo truncando a label para no máximo 50 caracteres", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-token"));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let githubPayload: any = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com/repos/aresta-climb/aresta_db/issues")) {
      githubPayload = JSON.parse(options?.body as string);
      return new Response(JSON.stringify({ html_url: "https://github.com/issue/long-id" }), { status: 201 });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Problema no croqui com id longo");
  formData.append(
    "metadata",
    JSON.stringify({
      feedbackId: "croqui-long-uuid",
      tipo_feedback: "croqui",
      croqui_id: "br_mg_santa_luzia_morro_do_carrapato_setor_covide",
      os: "android",
    })
  );

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(githubPayload !== null, true);
  // Todas as labels geradas devem ter 50 caracteres ou menos
  for (const label of githubPayload.labels) {
    assertEquals(label.length <= 50, true);
  }
  const labelPico = githubPayload.labels.find((l: string) => l.startsWith("pico:"));
  assertEquals(labelPico !== undefined, true);
  assertEquals(labelPico!.length, 50);

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: realiza retentativa automática sem labels se o GitHub responder 422 Validation Failed", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-token"));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let lastPayload: any = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com/repos/aresta-climb/aresta_db/issues")) {
      attempts++;
      lastPayload = JSON.parse(options?.body as string);
      if (attempts === 1) {
        return new Response(
          JSON.stringify({
            message: "Validation Failed",
            errors: [{ value: "invalid-label", resource: "Label", field: "name", code: "invalid" }],
          }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ html_url: "https://github.com/issue/fallback-422" }), { status: 201 });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste 422 fallback");
  formData.append(
    "metadata",
    JSON.stringify({
      feedbackId: "fallback-422-uuid",
      tipo_feedback: "app",
    })
  );

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(attempts, 2);
  assertEquals(lastPayload.labels, []);

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: realiza fallback gracioso ao inserir diagnóstico se colunas adicionais não existirem no Postgres", async () => {
  resetRateLimits();
  setCustomTokenProvider(() => Promise.resolve("gh-secret-token"));
  Deno.env.set("SUPABASE_URL", "https://aresta-prod-xyz.supabase.co");
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ service_role: "test-key" }));
  Deno.env.set("SKIP_APP_CHECK_VERIFICATION", "true");

  const originalFetch = globalThis.fetch;
  let diagnosticosAttempts = 0;
  let retryPayload: any = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.github.com/repos/aresta-climb/aresta_db/issues")) {
      return new Response(JSON.stringify({ html_url: "https://github.com/issue/fallback-col" }), { status: 201 });
    }
    if (urlStr.includes("feedback_diagnosticos")) {
      diagnosticosAttempts++;
      if (diagnosticosAttempts === 1) {
        return new Response(
          JSON.stringify({ message: 'column "submitted_at" of relation "feedback_diagnosticos" does not exist' }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      retryPayload = JSON.parse(options?.body as string);
      return new Response(JSON.stringify([{}]), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([{}]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const formData = new FormData();
  formData.append("description", "Teste de fallback de colunas");
  formData.append(
    "metadata",
    JSON.stringify({
      feedbackId: "fallback-col-uuid",
      tipo_feedback: "app",
      submittedAt: "05 de outubro de 2026",
      submittedAtTimestamp: "2026-10-05T00:00:00Z",
    })
  );

  const req = new Request("http://localhost", { method: "POST", body: formData });
  const res = await handleRequest(req);

  assertEquals(res.status, 200);
  assertEquals(diagnosticosAttempts, 2);
  assertEquals(retryPayload !== null, true);
  assertEquals("submitted_at" in retryPayload, false);
  assertEquals("submitted_at_timestamp" in retryPayload, false);
  assertEquals("breadcrumbs" in retryPayload, false);

  globalThis.fetch = originalFetch;
  setCustomTokenProvider(null);
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  Deno.env.delete("SKIP_APP_CHECK_VERIFICATION");
});

Deno.test("app-feedback: formatarBreadcrumbs formata lista de eventos com quebra de linha por evento", () => {
  assertEquals(formatarBreadcrumbs(null), null);
  assertEquals(formatarBreadcrumbs([]), null);
  assertEquals(formatarBreadcrumbs("evento_existente"), "evento_existente");

  const lista = [
    {
      timestamp: "2026-10-05T12:00:00.123-03:00",
      evento: "acao_croqui",
      parametros: { id_croqui: "pico_1", acao: "abrir_croqui" },
    },
    {
      timestamp: "2026-10-05T12:00:15.456-03:00",
      evento: "abrir_setor",
      parametros: { nome_setor: "Setor 1" },
    },
    {
      evento: "abrir_modal",
    },
  ];

  const formatado = formatarBreadcrumbs(lista);
  assertEquals(
    formatado,
    "[12:00:00] acao_croqui (id_croqui: pico_1, acao: abrir_croqui)\n[12:00:15] abrir_setor (nome_setor: Setor 1)\n[#3] abrir_modal"
  );
});




