// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import workerDefault, {
  CABECALHO_CACHE_PAGINA_LINK,
  CABECALHO_CACHE_WELL_KNOWN,
  processarRequisicao,
} from "../src/index.ts";
import { BancoD1Fake } from "./banco_d1_fake.ts";
import { RelatorSentryFake } from "../../../supabase/functions/compartilhado/relator_sentry_fake.ts";

function criarBancoComVia(): BancoD1Fake {
  const banco = new BancoD1Fake();
  banco.inserirCroqui({
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    nome: "Serra do Cipó",
    cidade: "Santana do Riacho",
    estado: "MG",
  });
  banco.inserirEntidade({
    uid: "ESCALA12345678",
    tipo: "escalada",
    croqui_uid: "CROQUI12345678",
    nome: "Rapa Nui",
    escalada_grau: "7b",
    escalada_tipo: "esportiva",
    setor_uid: null,
    grupo_uid: null,
  });
  return banco;
}

Deno.test("worker app-links: responde a OPTIONS com 204 e cabecalhos CORS", async () => {
  const req = new Request("https://aresta.cc/health", { method: "OPTIONS" });
  const res = await processarRequisicao(req);

  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("worker app-links: rejeita metodos POST, PUT e DELETE com 405", async () => {
  for (const metodo of ["POST", "PUT", "DELETE"]) {
    const req = new Request("https://aresta.cc/health", { method: metodo });
    const res = await processarRequisicao(req);

    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET, HEAD, OPTIONS");
  }
});

Deno.test("worker app-links: GET /health retorna 200 operacional com no-store", async () => {
  const req = new Request("https://aresta.cc/health");
  const res = await workerDefault.fetch(req, {});

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  assertStringIncludes(await res.text(), "operacional");
});

Deno.test("worker app-links: GET / redireciona com 302 Found para https://arestaclimb.com", async () => {
  const req = new Request("https://aresta.cc/");
  const res = await processarRequisicao(req);

  assertEquals(res.status, 302);
  assertEquals(res.headers.get("Location"), "https://arestaclimb.com");
});

Deno.test("worker app-links: redireciona www.aresta.cc com 301 para aresta.cc preservando caminho e query params", async () => {
  const req = new Request(
    "https://www.aresta.cc/s/ESCALA12345678?utm_source=teste"
  );
  const res = await processarRequisicao(req);

  assertEquals(res.status, 301);
  assertEquals(
    res.headers.get("Location"),
    "https://aresta.cc/s/ESCALA12345678?utm_source=teste"
  );
});

Deno.test("worker app-links: GET /.well-known/assetlinks.json retorna 200 com fingerprints SHA-256 do pacote Android", async () => {
  const req = new Request("https://aresta.cc/.well-known/assetlinks.json");
  const res = await processarRequisicao(req);

  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Content-Type"),
    "application/json; charset=utf-8"
  );
  assertEquals(res.headers.get("Cache-Control"), CABECALHO_CACHE_WELL_KNOWN);

  const corpo = await res.json();
  assertEquals(Array.isArray(corpo), true);
  assertEquals(corpo[0].target.package_name, "app.escalada.croquis");
  assertEquals(corpo[0].target.sha256_cert_fingerprints.length, 3);
});

Deno.test("worker app-links: GET /.well-known/apple-app-site-association retorna 200 com applinks do iOS", async () => {
  const req = new Request(
    "https://aresta.cc/.well-known/apple-app-site-association"
  );
  const res = await processarRequisicao(req);

  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Content-Type"),
    "application/json; charset=utf-8"
  );
  assertEquals(res.headers.get("Cache-Control"), CABECALHO_CACHE_WELL_KNOWN);

  const corpo = await res.json();
  assertEquals(corpo.applinks.details[0].appIDs, [
    "Z74K7R3WU7.app.escalada.croquis",
  ]);
  assertEquals(corpo.applinks.details[0].paths, ["/*"]);
});

Deno.test("worker app-links: serve /robots.txt e redireciona /favicon.ico e /favicon.svg com cache de 1 ano na borda", async () => {
  const resRobots = await processarRequisicao(
    new Request("https://aresta.cc/robots.txt")
  );
  assertEquals(resRobots.status, 200);
  assertEquals(
    resRobots.headers.get("Cache-Control"),
    "public, max-age=86400, s-maxage=31536000"
  );
  assertStringIncludes(await resRobots.text(), "User-agent: *");

  for (const rotaIcone of ["/favicon.ico", "/favicon.svg"]) {
    const resIcone = await processarRequisicao(
      new Request(`https://aresta.cc${rotaIcone}`)
    );
    assertEquals(resIcone.status, 301);
    assertEquals(
      resIcone.headers.get("Location"),
      "https://arestaclimb.com/favicon.svg"
    );
    assertEquals(
      resIcone.headers.get("Cache-Control"),
      "public, max-age=86400, s-maxage=31536000, immutable"
    );
  }
});

Deno.test("worker app-links: GET /s/<uid> resolve entidade no D1 e retorna HTML SSR 200 com OpenGraph, Umami e cache na borda", async () => {
  const banco = criarBancoComVia();
  const req = new Request("https://aresta.cc/s/ESCALA12345678");
  const res = await workerDefault.fetch(req, { DB: banco });

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  assertEquals(res.headers.get("Cache-Control"), CABECALHO_CACHE_PAGINA_LINK);

  const html = await res.text();
  assertStringIncludes(
    html,
    '<meta property="og:title" content="Rapa Nui (7b) — Serra do Cipó | Aresta">'
  );
  assertStringIncludes(
    html,
    "https://serving.arestaclimb.com/v4/thumbnails/br_mg_serra_do_cipo.webp"
  );
  assertStringIncludes(
    html,
    "https://arestaclimb.com/assets/logo_app.png"
  );
  assertStringIncludes(html, 'class="store-badge"');
  assertStringIncludes(html, "Esportiva");
  assertStringIncludes(html, '"utm_source":"compartilhamento"');
  assertStringIncludes(html, '"utm_medium":"social"');
});

Deno.test("worker app-links: GET /<uid> para UID inexistente no D1 (cache 24h) ou rota invalida (cache 1 ano) retorna 404 com pagina HTML amigavel", async () => {
  const banco = criarBancoComVia();

  const resUidInexistente = await processarRequisicao(
    new Request("https://aresta.cc/INEXISTENTE123"),
    { DB: banco }
  );
  assertEquals(resUidInexistente.status, 404);
  assertEquals(
    resUidInexistente.headers.get("Cache-Control"),
    "public, max-age=300, s-maxage=86400"
  );
  assertStringIncludes(await resUidInexistente.text(), "Link não encontrado");

  const resRotaInvalida = await processarRequisicao(
    new Request("https://aresta.cc/caminho/invalido/demais"),
    { DB: banco }
  );
  assertEquals(resRotaInvalida.status, 404);
  assertEquals(
    resRotaInvalida.headers.get("Cache-Control"),
    "public, max-age=300, s-maxage=31536000"
  );
  assertStringIncludes(await resRotaInvalida.text(), "Link não encontrado");
});

Deno.test("worker app-links: retorna 500 com no-store e reporta ao Sentry quando binding DB nao esta configurado ou falha", async () => {
  const req = new Request("https://aresta.cc/ESCALA12345678");
  const relatorFake = new RelatorSentryFake();

  const resSemDb = await processarRequisicao(req, {
    SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
    relatorSentry: relatorFake,
  });
  assertEquals(resSemDb.status, 500);
  assertEquals(resSemDb.headers.get("Cache-Control"), "no-store");
  assertEquals(relatorFake.eventos.length, 1);
  assertEquals(relatorFake.eventos[0].servico, "cloudflare-app-links");
  assertEquals(
    relatorFake.eventos[0].mensagem,
    "Binding DB do Cloudflare D1 não configurado"
  );

  const bancoComFalha = criarBancoComVia();
  bancoComFalha.configurarFalha("D1 fora do ar");
  const resErroDb = await processarRequisicao(req, {
    DB: bancoComFalha,
    SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
    relatorSentry: relatorFake,
  });
  assertEquals(resErroDb.status, 500);
  assertEquals(resErroDb.headers.get("Cache-Control"), "no-store");
  assertStringIncludes(await resErroDb.text(), "D1 fora do ar");
  assertEquals(relatorFake.eventos.length, 2);
  assertEquals(relatorFake.eventos[1].servico, "cloudflare-app-links");
  assertEquals(relatorFake.eventos[1].mensagem, "D1 fora do ar");

  const bancoComExcecaoLiteral = {
    prepare() {
      return {
        bind() {
          return this;
        },
        all() {
          return Promise.reject("erro_literal_string");
        },
      };
    },
  };
  const resErroLiteral = await processarRequisicao(req, {
    DB: bancoComExcecaoLiteral,
    SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
    relatorSentry: relatorFake,
  });
  assertEquals(resErroLiteral.status, 500);
  assertStringIncludes(await resErroLiteral.text(), "erro_literal_string");
  assertEquals(relatorFake.eventos.length, 3);
  assertEquals(relatorFake.eventos[2].mensagem, "erro_literal_string");
});
