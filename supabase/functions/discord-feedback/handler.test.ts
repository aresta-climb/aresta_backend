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
    fetchCalledWithUrl = url.toString();
    fetchCalledWithFormData = options?.body as FormData;
    return new Response("ok", { status: 200 });
  };

  const formData = new FormData();
  formData.append("description", "This is a test feedback");
  formData.append("metadata", JSON.stringify({ os: "android" }));

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
});
