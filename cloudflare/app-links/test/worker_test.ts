// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import workerDefault, {
  CABECALHO_CACHE_PAGINA_LINK,
  CABECALHO_CACHE_REDIRECIONAMENTO_LONGO,
  CABECALHO_CACHE_THUMBNAIL_OG,
  CABECALHO_CACHE_WELL_KNOWN,
  ClienteThumbnailHttp,
  criarOpcoesSentry,
  processarRequisicao,
} from "../src/index.ts";
import { BancoD1Fake } from "./banco_d1_fake.ts";
import { ClienteThumbnailFake } from "./cliente_thumbnail_fake.ts";
import { RelatorSentryFake } from "../../../supabase/functions/compartilhado/relator_sentry_fake.ts";

function criarBancoComVia(): BancoD1Fake {
  const banco = new BancoD1Fake();
  banco.inserirCroqui({
    croqui_uid: "CROQUI12345678",
    id_slug: "br_mg_serra_do_cipo",
    nome: "Serra do Cipó",
    cidade: "Santana do Riacho",
    estado: "MG",
    latitude_e7: -193456780,
    longitude_e7: -436123450,
    url_google_maps: "https://maps.app.goo.gl/SerraDoCipo",
  });
  banco.inserirEntidade({
    uid: "SETOR123456789",
    tipo: "setor",
    croqui_uid: "CROQUI12345678",
    nome: "Setor Vale da Lua",
    escalada_grau: null,
    escalada_tipo: null,
    setor_uid: null,
    grupo_uid: null,
  });
  banco.inserirEntidade({
    uid: "ESCALA12345678",
    tipo: "escalada",
    croqui_uid: "CROQUI12345678",
    nome: "Rapa Nui",
    escalada_grau: "7b",
    escalada_tipo: "esportiva",
    setor_uid: "SETOR123456789",
    grupo_uid: null,
  });
  return banco;
}

Deno.test("worker app-links: responde a OPTIONS com 204 e rejeita POST/PUT/DELETE com 405", async () => {
  const resOptions = await processarRequisicao(
    new Request("https://aresta.cc/health", { method: "OPTIONS" })
  );
  assertEquals(resOptions.status, 204);
  assertEquals(resOptions.headers.get("Access-Control-Allow-Origin"), "*");

  for (const metodo of ["POST", "PUT", "DELETE"]) {
    const res = await processarRequisicao(
      new Request("https://aresta.cc/health", { method: metodo })
    );
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET, HEAD, OPTIONS");
  }
});

Deno.test("worker app-links: GET /health retorna 200, GET / em aresta.cc redireciona 302 para /croquis e normaliza www.*", async () => {
  const resHealth = await workerDefault.fetch(
    new Request("https://aresta.cc/health"),
    {}
  );
  assertEquals(resHealth.status, 200);
  assertEquals(resHealth.headers.get("Cache-Control"), "no-store");
  assertStringIncludes(await resHealth.text(), "operacional");

  const resRaiz = await processarRequisicao(new Request("https://aresta.cc/"));
  assertEquals(resRaiz.status, 302);
  assertEquals(
    resRaiz.headers.get("Location"),
    "https://arestaclimb.com/croquis"
  );

  const resWwwCurto = await processarRequisicao(
    new Request("https://www.aresta.cc/s/ESCALA12345678?utm_source=teste")
  );
  assertEquals(resWwwCurto.status, 301);
  assertEquals(
    resWwwCurto.headers.get("Location"),
    "https://aresta.cc/s/ESCALA12345678?utm_source=teste"
  );

  const resWwwSite = await processarRequisicao(
    new Request("https://www.arestaclimb.com/croquis?uf=MG")
  );
  assertEquals(resWwwSite.status, 301);
  assertEquals(
    resWwwSite.headers.get("Location"),
    "https://arestaclimb.com/croquis?uf=MG"
  );
});

Deno.test("worker app-links: serve /.well-known/*, /robots.txt e /favicon.* com cache longo na borda", async () => {
  const resAndroid = await processarRequisicao(
    new Request("https://aresta.cc/.well-known/assetlinks.json")
  );
  assertEquals(resAndroid.status, 200);
  assertEquals(resAndroid.headers.get("Cache-Control"), CABECALHO_CACHE_WELL_KNOWN);
  const jsonAndroid = await resAndroid.json();
  assertEquals(jsonAndroid[0].target.package_name, "app.escalada.croquis");

  const resIos = await processarRequisicao(
    new Request("https://aresta.cc/.well-known/apple-app-site-association")
  );
  assertEquals(resIos.status, 200);
  const jsonIos = await resIos.json();
  assertEquals(jsonIos.applinks.details[0].paths, ["/*"]);

  const resRobots = await processarRequisicao(
    new Request("https://aresta.cc/robots.txt")
  );
  assertEquals(resRobots.status, 200);
  assertStringIncludes(await resRobots.text(), "User-agent: *");

  const resSvg = await processarRequisicao(
    new Request("https://aresta.cc/favicon.svg")
  );
  assertEquals(resSvg.status, 200);
  assertEquals(resSvg.headers.get("Content-Type"), "image/svg+xml; charset=utf-8");
  assertStringIncludes(await resSvg.text(), "#ea5341");

  const resIco = await processarRequisicao(
    new Request("https://aresta.cc/favicon.ico")
  );
  assertEquals(resIco.status, 301);
  assertEquals(
    resIco.headers.get("Location"),
    "https://arestaclimb.com/favicon.ico"
  );
});

Deno.test("worker app-links: aresta.cc/<prefixo>/<uid> redireciona com 301 (cache 30d) para arestaclimb.com/croquis/<uid>/<slug> preservando CGI args, mapa e UTMs", async () => {
  const banco = criarBancoComVia();
  const req = new Request(
    "https://aresta.cc/sm/ESCALA12345678?campanha=inverno"
  );
  const res = await workerDefault.fetch(req, { DB: banco });

  assertEquals(res.status, 301);
  assertEquals(
    res.headers.get("Cache-Control"),
    CABECALHO_CACHE_REDIRECIONAMENTO_LONGO
  );
  assertEquals(
    res.headers.get("Location"),
    "https://arestaclimb.com/croquis/ESCALA12345678/mg-serra-do-cipo-rapa-nui?campanha=inverno&mapa=1&utm_source=compartilhamento&utm_medium=social"
  );
  assertEquals(banco.totalConsultasExecutadas, 1);
});

Deno.test("worker vitrine: serve /croquis (diretorio + mapao), normaliza /croquis/ com 301, serve /croquis/busca.json e /croquis/sitemap.xml com cache de 7 dias", async () => {
  const banco = criarBancoComVia();

  const resBarra = await processarRequisicao(
    new Request("https://arestaclimb.com/croquis/?utm_source=menu"),
    { DB: banco }
  );
  assertEquals(resBarra.status, 301);
  assertEquals(
    resBarra.headers.get("Location"),
    "https://arestaclimb.com/croquis?utm_source=menu"
  );

  const resIndice = await processarRequisicao(
    new Request("https://arestaclimb.com/croquis"),
    { DB: banco }
  );
  assertEquals(resIndice.status, 200);
  assertEquals(
    resIndice.headers.get("Cache-Control"),
    CABECALHO_CACHE_PAGINA_LINK
  );
  const htmlIndice = await resIndice.text();
  assertStringIncludes(htmlIndice, "Serra do Cipó");
  assertStringIncludes(htmlIndice, 'id="mapaVitrineCroquis"');
  assertStringIncludes(htmlIndice, "/croquis/busca.json");

  const resBusca = await processarRequisicao(
    new Request("https://arestaclimb.com/croquis/busca.json"),
    { DB: banco }
  );
  assertEquals(resBusca.status, 200);
  assertEquals(
    resBusca.headers.get("Content-Type"),
    "application/json; charset=utf-8"
  );
  assertEquals(
    resBusca.headers.get("Cache-Control"),
    CABECALHO_CACHE_PAGINA_LINK
  );
  const itensBusca = await resBusca.json();
  assertEquals(itensBusca.length, 3);
  assertEquals(
    itensBusca.some(
      (i: { uid: string; slug: string }) =>
        i.uid === "ESCALA12345678" && i.slug === "mg-serra-do-cipo-rapa-nui"
    ),
    true
  );

  const resSitemap = await processarRequisicao(
    new Request("https://arestaclimb.com/croquis/sitemap.xml"),
    { DB: banco }
  );
  assertEquals(resSitemap.status, 200);
  assertEquals(
    resSitemap.headers.get("Content-Type"),
    "application/xml; charset=utf-8"
  );
  assertStringIncludes(
    await resSitemap.text(),
    "<loc>https://arestaclimb.com/croquis/ESCALA12345678/mg-serra-do-cipo-rapa-nui</loc>"
  );
});

Deno.test("worker vitrine: redireciona 301 quando falta slug ou slug antigo diverge e renderiza HTML SSR 200 quando slug bate com o canonico", async () => {
  const banco = criarBancoComVia();

  const resSemSlug = await processarRequisicao(
    new Request("https://arestaclimb.com/croquis/SETOR123456789?mapa=1"),
    { DB: banco }
  );
  assertEquals(resSemSlug.status, 301);
  assertEquals(
    resSemSlug.headers.get("Location"),
    "https://arestaclimb.com/croquis/SETOR123456789/mg-serra-do-cipo-setor-vale-da-lua?mapa=1"
  );

  const resSlugAntigo = await processarRequisicao(
    new Request(
      "https://arestaclimb.com/croquis/SETOR123456789/slug-velho?utm_source=google"
    ),
    { DB: banco }
  );
  assertEquals(resSlugAntigo.status, 301);
  assertEquals(
    resSlugAntigo.headers.get("Location"),
    "https://arestaclimb.com/croquis/SETOR123456789/mg-serra-do-cipo-setor-vale-da-lua?utm_source=google"
  );

  const resOk = await processarRequisicao(
    new Request(
      "https://arestaclimb.com/croquis/SETOR123456789/mg-serra-do-cipo-setor-vale-da-lua"
    ),
    { DB: banco }
  );
  assertEquals(resOk.status, 200);
  assertEquals(resOk.headers.get("Cache-Control"), CABECALHO_CACHE_PAGINA_LINK);
  const html = await resOk.text();
  assertStringIncludes(html, "Setor Vale da Lua");
  assertStringIncludes(html, "Rapa Nui");
  assertStringIncludes(html, "https://maps.app.goo.gl/SerraDoCipo");
});

Deno.test("worker app-links: GET e HEAD /og/<id_slug>.webp servem miniatura com cache de 7 dias, 404 quando ausente e 502 com Sentry em falha", async () => {
  const clienteThumb = new ClienteThumbnailFake();
  const bytesWebp = new Uint8Array([82, 73, 70, 0, 87, 69, 66, 80]);
  clienteThumb.inserirThumbnail("br_mg_serra_do_cipo", bytesWebp);

  const resGet = await processarRequisicao(
    new Request("https://aresta.cc/og/br_mg_serra_do_cipo.webp"),
    { clienteThumbnail: clienteThumb }
  );
  assertEquals(resGet.status, 200);
  assertEquals(resGet.headers.get("Cache-Control"), CABECALHO_CACHE_THUMBNAIL_OG);
  assertEquals(new Uint8Array(await resGet.arrayBuffer()), bytesWebp);

  const resHead = await processarRequisicao(
    new Request("https://aresta.cc/og/br_mg_serra_do_cipo.webp", {
      method: "HEAD",
    }),
    { clienteThumbnail: clienteThumb }
  );
  assertEquals(resHead.status, 200);
  assertEquals(await resHead.text(), "");

  const res404 = await processarRequisicao(
    new Request("https://aresta.cc/og/croqui_inexistente.webp"),
    { clienteThumbnail: clienteThumb }
  );
  assertEquals(res404.status, 404);

  const relatorFake = new RelatorSentryFake();
  clienteThumb.configurarFalha("Falha na CDN de thumbnails");
  const res502 = await processarRequisicao(
    new Request("https://aresta.cc/og/br_mg_serra_do_cipo.webp"),
    {
      clienteThumbnail: clienteThumb,
      SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
      relatorSentry: relatorFake,
    }
  );
  assertEquals(res502.status, 502);
  assertEquals(relatorFake.eventos.length, 1);

  const clienteComErroLiteral: ClienteThumbnailFake = {
    obterThumbnail() {
      return Promise.reject("erro_rede_literal");
    },
  } as unknown as ClienteThumbnailFake;
  const res502Literal = await processarRequisicao(
    new Request("https://aresta.cc/og/br_mg_serra_do_cipo.webp"),
    {
      clienteThumbnail: clienteComErroLiteral,
      SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
      relatorSentry: relatorFake,
    }
  );
  assertEquals(res502Literal.status, 502);
  assertStringIncludes(await res502Literal.text(), "erro_rede_literal");
});

Deno.test("ClienteThumbnailHttp e criarOpcoesSentry: busca miniatura na CDN e higieniza cabecalhos sensiveis", async () => {
  let urlRequisitada = "";
  let metodoRequisitado = "";

  const fetchSimulado: typeof fetch = (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    urlRequisitada = String(input);
    metodoRequisitado = init?.method || "GET";
    return Promise.resolve(
      new Response(
        metodoRequisitado === "HEAD" ? null : new Uint8Array([1, 2, 3]),
        { status: 200, headers: { "Content-Type": "image/webp" } }
      )
    );
  };

  const cliente = new ClienteThumbnailHttp(fetchSimulado);
  const resOk = await cliente.obterThumbnail("br_mg_serra_do_cipo", "GET");
  assertEquals(
    urlRequisitada,
    "https://serving.arestaclimb.com/v4/thumbnails/br_mg_serra_do_cipo.webp"
  );
  assertEquals(resOk.status, 200);

  const resHead = await cliente.obterThumbnail("br_mg_serra_do_cipo", "HEAD");
  assertEquals(resHead.corpo, null);

  const fetchSemContentType: typeof fetch = (): Promise<Response> =>
    Promise.resolve(new Response(new Uint8Array([9]), { status: 200 }));
  const clienteSemHeader = new ClienteThumbnailHttp(fetchSemContentType);
  const resPadrao = await clienteSemHeader.obterThumbnail("slug", "GET");
  assertEquals(resPadrao.contentType, "image/webp");

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchSemContentType;
  try {
    const resDefault = await processarRequisicao(
      new Request("https://aresta.cc/og/br_mg_serra_do_cipo.webp")
    );
    assertEquals(resDefault.status, 200);
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const opcoesSentry = criarOpcoesSentry({
    SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
  });
  const eventoComHeaders = opcoesSentry.beforeSend({
    request: {
      headers: {
        authorization: "Bearer segredo",
        cookie: "sessao=123",
        "x-api-key": "chave",
        "user-agent": "WhatsApp/2.24",
      },
    },
  } as never);
  assertEquals(eventoComHeaders?.request?.headers, {
    "user-agent": "WhatsApp/2.24",
  });
  const eventoSemHeaders = opcoesSentry.beforeSend({ type: undefined } as never);
  assertEquals(eventoSemHeaders, { type: undefined });
});

Deno.test("worker app-links e vitrine: retornam 404 para rotas invalidas ou UIDs ausentes e 500 com Sentry quando DB ausente ou falha", async () => {
  const banco = criarBancoComVia();

  for (const url404 of [
    "https://aresta.cc/INEXISTENTE123",
    "https://aresta.cc/caminho/invalido/demais",
    "https://arestaclimb.com/croquis/INEXISTENTE123/qualquer",
    "https://arestaclimb.com/croquis/invalido",
  ]) {
    const res404 = await processarRequisicao(new Request(url404), { DB: banco });
    assertEquals(res404.status, 404);
    assertStringIncludes(await res404.text(), "Link não encontrado");
  }

  const relatorFake = new RelatorSentryFake();
  for (const url500 of [
    "https://aresta.cc/ESCALA12345678",
    "https://arestaclimb.com/croquis",
    "https://arestaclimb.com/croquis/busca.json",
    "https://arestaclimb.com/croquis/sitemap.xml",
    "https://arestaclimb.com/croquis/ESCALA12345678/slug",
  ]) {
    const resSemDb = await processarRequisicao(new Request(url500), {
      SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
      relatorSentry: relatorFake,
    });
    assertEquals(resSemDb.status, 500);
    assertEquals(resSemDb.headers.get("Cache-Control"), "no-store");
  }

  const bancoComFalha = criarBancoComVia();
  bancoComFalha.configurarFalha("D1 fora do ar");
  for (const urlErro of [
    "https://aresta.cc/ESCALA12345678",
    "https://arestaclimb.com/croquis",
    "https://arestaclimb.com/croquis/busca.json",
    "https://arestaclimb.com/croquis/sitemap.xml",
    "https://arestaclimb.com/croquis/ESCALA12345678/slug",
  ]) {
    const resErro = await processarRequisicao(new Request(urlErro), {
      DB: bancoComFalha,
      SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
      relatorSentry: relatorFake,
    });
    assertEquals(resErro.status, 500);
    assertStringIncludes(await resErro.text(), "D1 fora do ar");
  }

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
  const resErroLiteral = await processarRequisicao(
    new Request("https://arestaclimb.com/croquis"),
    {
      DB: bancoComExcecaoLiteral,
      SENTRY_DSN: "https://pub@o1.ingest.sentry.io/1",
      relatorSentry: relatorFake,
    }
  );
  assertEquals(resErroLiteral.status, 500);
  assertStringIncludes(await resErroLiteral.text(), "erro_literal_string");
});
