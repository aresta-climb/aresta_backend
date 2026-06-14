import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { handleRequest } from "./handler.ts";

Deno.test("handleRequest - returns CORS headers for OPTIONS request", async () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const res = await handleRequest(req);
  
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleRequest - returns 500 if DISCORD_WEBHOOK_URL is missing", async () => {
  // Ensure the env var is not set
  const originalEnv = Deno.env.get("DISCORD_WEBHOOK_URL");
  Deno.env.delete("DISCORD_WEBHOOK_URL");

  // Mock console.error to avoid polluting test output with expected errors
  const originalConsoleError = console.error;
  console.error = () => {};

  const req = new Request("http://localhost", { 
    method: "POST",
    body: JSON.stringify({ message: "Test" })
  });
  const res = await handleRequest(req);
  
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.includes("DISCORD_WEBHOOK_URL"), true);

  // Restore console.error and env
  console.error = originalConsoleError;
  if (originalEnv) Deno.env.set("DISCORD_WEBHOOK_URL", originalEnv);
});

Deno.test("handleRequest - returns 400 if message is missing", async () => {
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");

  const req = new Request("http://localhost", { 
    method: "POST",
    body: JSON.stringify({ userName: "John" })
  });
  const res = await handleRequest(req);
  
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Feedback message is required");
});

Deno.test("handleRequest - successfully sends to Discord", async () => {
  Deno.env.set("DISCORD_WEBHOOK_URL", "http://test-webhook");

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  let fetchCalledWithUrl = "";
  let fetchCalledWithPayload: any = null;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    fetchCalledWithUrl = url.toString();
    fetchCalledWithPayload = JSON.parse(options?.body as string);
    return new Response("ok", { status: 200 });
  };

  const req = new Request("http://localhost", { 
    method: "POST",
    body: JSON.stringify({ message: "This is a test feedback", userName: "Alice" })
  });

  const res = await handleRequest(req);
  
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  
  assertEquals(fetchCalledWithUrl, "http://test-webhook");
  assertEquals(fetchCalledWithPayload.embeds[0].fields[0].value, "Alice");
  assertEquals(fetchCalledWithPayload.embeds[0].fields[3].value, "This is a test feedback");

  // Restore fetch
  globalThis.fetch = originalFetch;
});
