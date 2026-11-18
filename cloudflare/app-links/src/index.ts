// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ROTA_LISTAR_VITRINE_CROQUIS,
  ROTA_OBTER_ASSETLINKS_ANDROID,
  ROTA_OBTER_ASSOCIACAO_IOS,
  ROTA_OBTER_FAVICON_ICO,
  ROTA_OBTER_FAVICON_SVG,
  ROTA_OBTER_INDICE_BUSCA_VITRINE,
  ROTA_OBTER_ROBOTS_TXT,
  ROTA_OBTER_SITEMAP_VITRINE,
  ROTA_VERIFICAR_SAUDE_APP_LINKS,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";
import {
  analisarRotaLink,
  analisarRotaVitrineEntidade,
  extrairSlugThumbnailOg,
} from "./analisador_rota_link.ts";
import {
  URL_VITRINE_CROQUIS,
  renderizarPaginaEntidade,
  renderizarPaginaNaoEncontrada,
} from "./renderizador_pagina_link.ts";
import {
  renderizarPaginaIndiceVitrine,
  renderizarSitemapVitrine,
} from "./renderizador_vitrine_indice.ts";
import {
  BancoD1,
  listarCroquisVitrine,
  listarItensBuscaESitemap,
  resolverEntidadePorUid,
} from "./resolvedor_entidade_d1.ts";
import {
  DOMINIO_VITRINE_CANONICO,
  construirCaminhoVitrineEntidade,
  construirSlugCanonicoEntidade,
  construirUrlCanonicaVitrine,
  construirUrlRedirecionamentoArestaCc,
} from "./slug_vitrine.ts";
import * as Sentry from "@sentry/cloudflare";
import {
  ContextoExecucaoAssincrona,
  InterfaceRelatorSentry,
  relatarErroSentry,
} from "../../../supabase/functions/compartilhado/relator_sentry.ts";

export interface RespostaThumbnailOg {
  status: number;
  corpo: BodyInit | null;
  contentType: string;
}

export interface ClienteThumbnailOg {
  obterThumbnail(idSlug: string, metodo: string): Promise<RespostaThumbnailOg>;
}

const URL_ORIGEM_THUMBNAILS = "https://serving.arestaclimb.com/v4/thumbnails";
const TTL_BORDA_UM_ANO_SEGUNDOS = 31536000;
const TTL_BORDA_TRINTA_DIAS_SEGUNDOS = 2592000;
const TTL_BORDA_SETE_DIAS_SEGUNDOS = 604800;
const TTL_BORDA_UM_DIA_SEGUNDOS = 86400;

export class ClienteThumbnailHttp implements ClienteThumbnailOg {
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async obterThumbnail(
    idSlug: string,
    metodo: string
  ): Promise<RespostaThumbnailOg> {
    const url = `${URL_ORIGEM_THUMBNAILS}/${encodeURIComponent(idSlug)}.webp`;
    const resposta = await this.fetchFn(url, {
      method: metodo,
      ...({
        cf: {
          cacheTtl: TTL_BORDA_SETE_DIAS_SEGUNDOS,
          cacheEverything: true,
        },
      } as RequestInit),
    });

    return {
      status: resposta.status,
      corpo: metodo === "HEAD" ? null : resposta.body,
      contentType: resposta.headers.get("Content-Type") || "image/webp",
    };
  }
}

export interface AmbienteAppLinks {
  DB?: BancoD1;
  SENTRY_DSN?: string;
  relatorSentry?: InterfaceRelatorSentry;
  clienteThumbnail?: ClienteThumbnailOg;
}

const URL_FAVICON_OFICIAL = "https://arestaclimb.com/favicon.svg";
const CONTEUDO_ROBOTS_TXT = `User-agent: *\nAllow: /\nSitemap: ${DOMINIO_VITRINE_CANONICO}${ROTA_OBTER_SITEMAP_VITRINE}\n`;

export const cabecalhosCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const CABECALHO_CACHE_WELL_KNOWN = `public, max-age=86400, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`;

export const CABECALHO_CACHE_PAGINA_LINK = `public, max-age=14400, s-maxage=${TTL_BORDA_SETE_DIAS_SEGUNDOS}, stale-while-revalidate=${TTL_BORDA_UM_DIA_SEGUNDOS}`;

export const CABECALHO_CACHE_REDIRECIONAMENTO_LONGO = `public, max-age=86400, s-maxage=${TTL_BORDA_TRINTA_DIAS_SEGUNDOS}, stale-while-revalidate=${TTL_BORDA_UM_DIA_SEGUNDOS}`;

export const CABECALHO_CACHE_THUMBNAIL_OG = `public, max-age=86400, s-maxage=${TTL_BORDA_SETE_DIAS_SEGUNDOS}, stale-while-revalidate=${TTL_BORDA_UM_DIA_SEGUNDOS}`;

const CONTEUDO_ASSETLINKS_ANDROID = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "app.escalada.croquis",
      sha256_cert_fingerprints: [
        "53:47:51:33:74:B1:E2:6E:57:9A:A8:7D:8C:0C:61:48:33:D5:06:36:52:1D:1D:9D:34:63:03:B3:65:FF:CC:F8",
        "F1:93:B5:26:33:3C:35:F7:EA:72:2D:CD:AD:90:E7:74:32:97:10:6F:FF:B7:FA:DF:EB:B5:E9:E0:7E:F9:C3:D5",
        "36:74:5F:C0:4B:CF:5E:4B:E7:45:7F:D9:32:A3:4B:19:62:0C:C3:6F:8A:F9:CB:11:22:0C:B8:2C:F0:1C:47:9B",
      ],
    },
  },
];

const CONTEUDO_ASSOCIACAO_IOS = {
  applinks: {
    apps: [],
    details: [
      {
        appIDs: ["Z74K7R3WU7.app.escalada.croquis"],
        appID: "Z74K7R3WU7.app.escalada.croquis",
        paths: ["/*"],
        components: [{ "/": "/*" }],
      },
    ],
  },
};

function responderHtml(
  html: string,
  status: number,
  cacheControl: string
): Response {
  return new Response(html, {
    status,
    headers: {
      ...cabecalhosCors,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function responderRedirecionamento(
  destino: string,
  status: 301 | 302,
  cacheControl: string
): Response {
  return new Response(null, {
    status,
    headers: {
      ...cabecalhosCors,
      Location: destino,
      "Cache-Control": cacheControl,
    },
  });
}

async function responderErroBancoAusente(
  req: Request,
  env: AmbienteAppLinks,
  ctx?: ContextoExecucaoAssincrona
): Promise<Response> {
  await relatarErroSentry(
    new Error("Binding DB do Cloudflare D1 não configurado"),
    {
      dsn: env.SENTRY_DSN,
      servico: "cloudflare-app-links",
      requisicao: req,
      contextoExecucao: ctx,
    },
    env.relatorSentry
  );
  return new Response("Binding DB do Cloudflare D1 não configurado", {
    status: 500,
    headers: {
      ...cabecalhosCors,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function responderErroConsultaD1(
  erro: unknown,
  req: Request,
  env: AmbienteAppLinks,
  ctx?: ContextoExecucaoAssincrona
): Promise<Response> {
  await relatarErroSentry(
    erro,
    {
      dsn: env.SENTRY_DSN,
      servico: "cloudflare-app-links",
      requisicao: req,
      contextoExecucao: ctx,
    },
    env.relatorSentry
  );
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return new Response(`Erro ao consultar entidade no D1: ${mensagem}`, {
    status: 500,
    headers: {
      ...cabecalhosCors,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function processarRotaVitrineCroquis(
  req: Request,
  url: URL,
  env: AmbienteAppLinks,
  ctx?: ContextoExecucaoAssincrona
): Promise<Response> {
  const caminho = url.pathname;

  if (caminho === "/croquis/") {
    return responderRedirecionamento(
      `${URL_VITRINE_CROQUIS}${url.search}`,
      301,
      `public, max-age=86400, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`
    );
  }

  if (caminho === ROTA_LISTAR_VITRINE_CROQUIS) {
    if (!env.DB) return responderErroBancoAusente(req, env, ctx);
    try {
      const croquis = await listarCroquisVitrine(env.DB);
      return responderHtml(
        renderizarPaginaIndiceVitrine(croquis),
        200,
        CABECALHO_CACHE_PAGINA_LINK
      );
    } catch (erro: unknown) {
      return responderErroConsultaD1(erro, req, env, ctx);
    }
  }

  if (caminho === ROTA_OBTER_INDICE_BUSCA_VITRINE) {
    if (!env.DB) return responderErroBancoAusente(req, env, ctx);
    try {
      const itens = await listarItensBuscaESitemap(env.DB);
      return new Response(JSON.stringify(itens), {
        status: 200,
        headers: {
          ...cabecalhosCors,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": CABECALHO_CACHE_PAGINA_LINK,
        },
      });
    } catch (erro: unknown) {
      return responderErroConsultaD1(erro, req, env, ctx);
    }
  }

  if (caminho === ROTA_OBTER_SITEMAP_VITRINE) {
    if (!env.DB) return responderErroBancoAusente(req, env, ctx);
    try {
      const itens = await listarItensBuscaESitemap(env.DB);
      return new Response(renderizarSitemapVitrine(itens), {
        status: 200,
        headers: {
          ...cabecalhosCors,
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": CABECALHO_CACHE_PAGINA_LINK,
        },
      });
    } catch (erro: unknown) {
      return responderErroConsultaD1(erro, req, env, ctx);
    }
  }

  const rotaVitrine = analisarRotaVitrineEntidade(url);
  if (!rotaVitrine) {
    return responderHtml(
      renderizarPaginaNaoEncontrada(),
      404,
      `public, max-age=300, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`
    );
  }

  if (!env.DB) return responderErroBancoAusente(req, env, ctx);

  try {
    const entidade = await resolverEntidadePorUid(
      env.DB,
      rotaVitrine.metadados.uid,
      { incluirSubentidades: true }
    );
    if (!entidade) {
      return responderHtml(
        renderizarPaginaNaoEncontrada(),
        404,
        `public, max-age=300, s-maxage=${TTL_BORDA_UM_DIA_SEGUNDOS}`
      );
    }

    const slugCanonico = construirSlugCanonicoEntidade(entidade);
    if (rotaVitrine.slugInformado !== slugCanonico) {
      const caminhoCanonico = construirCaminhoVitrineEntidade(
        entidade.uid,
        slugCanonico
      );
      return responderRedirecionamento(
        `${DOMINIO_VITRINE_CANONICO}${caminhoCanonico}${url.search}`,
        301,
        CABECALHO_CACHE_REDIRECIONAMENTO_LONGO
      );
    }

    const html = renderizarPaginaEntidade(entidade, rotaVitrine.metadados);
    return responderHtml(html, 200, CABECALHO_CACHE_PAGINA_LINK);
  } catch (erro: unknown) {
    return responderErroConsultaD1(erro, req, env, ctx);
  }
}

/**
 * Roteador principal unificado do Worker `aresta-app-links` (`aresta.cc` e `arestaclimb.com/croquis*`).
 */
export async function processarRequisicao(
  req: Request,
  env: AmbienteAppLinks = {},
  ctx?: ContextoExecucaoAssincrona
): Promise<Response> {
  const url = new URL(req.url);
  const caminho = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cabecalhosCors, status: 204 });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Método não permitido", {
      status: 405,
      headers: { ...cabecalhosCors, Allow: "GET, HEAD, OPTIONS" },
    });
  }

  if (url.hostname === "www.aresta.cc") {
    return responderRedirecionamento(
      `https://aresta.cc${url.pathname}${url.search}`,
      301,
      `public, max-age=86400, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`
    );
  }

  if (url.hostname === "www.arestaclimb.com") {
    return responderRedirecionamento(
      `${DOMINIO_VITRINE_CANONICO}${url.pathname}${url.search}`,
      301,
      `public, max-age=86400, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`
    );
  }

  if (caminho === ROTA_VERIFICAR_SAUDE_APP_LINKS) {
    return new Response("Aresta App Links operacional", {
      status: 200,
      headers: {
        ...cabecalhosCors,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (caminho === "/croquis" || caminho.startsWith("/croquis/")) {
    return processarRotaVitrineCroquis(req, url, env, ctx);
  }

  if (caminho === "/") {
    return responderRedirecionamento(
      URL_VITRINE_CROQUIS,
      302,
      `public, max-age=3600, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`
    );
  }

  if (caminho === ROTA_OBTER_ROBOTS_TXT) {
    return new Response(CONTEUDO_ROBOTS_TXT, {
      status: 200,
      headers: {
        ...cabecalhosCors,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": `public, max-age=86400, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`,
      },
    });
  }

  if (
    caminho === ROTA_OBTER_FAVICON_ICO ||
    caminho === ROTA_OBTER_FAVICON_SVG
  ) {
    return responderRedirecionamento(
      URL_FAVICON_OFICIAL,
      301,
      `public, max-age=86400, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}, immutable`
    );
  }

  if (caminho === ROTA_OBTER_ASSETLINKS_ANDROID) {
    return new Response(JSON.stringify(CONTEUDO_ASSETLINKS_ANDROID, null, 2), {
      status: 200,
      headers: {
        ...cabecalhosCors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": CABECALHO_CACHE_WELL_KNOWN,
      },
    });
  }

  if (caminho === ROTA_OBTER_ASSOCIACAO_IOS) {
    return new Response(JSON.stringify(CONTEUDO_ASSOCIACAO_IOS, null, 2), {
      status: 200,
      headers: {
        ...cabecalhosCors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": CABECALHO_CACHE_WELL_KNOWN,
      },
    });
  }

  const slugThumbnailOg = extrairSlugThumbnailOg(caminho);
  if (slugThumbnailOg) {
    const clienteThumb = env.clienteThumbnail ?? new ClienteThumbnailHttp();
    try {
      const resultadoThumb = await clienteThumb.obterThumbnail(
        slugThumbnailOg,
        req.method
      );
      if (resultadoThumb.status !== 200) {
        return new Response("Miniatura não encontrada", {
          status: 404,
          headers: {
            ...cabecalhosCors,
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": `public, max-age=300, s-maxage=${TTL_BORDA_UM_DIA_SEGUNDOS}`,
          },
        });
      }

      return new Response(resultadoThumb.corpo, {
        status: 200,
        headers: {
          ...cabecalhosCors,
          "Content-Type": resultadoThumb.contentType,
          "Cache-Control": CABECALHO_CACHE_THUMBNAIL_OG,
        },
      });
    } catch (erro: unknown) {
      await relatarErroSentry(
        erro,
        {
          dsn: env.SENTRY_DSN,
          servico: "cloudflare-app-links",
          requisicao: req,
          contextoExecucao: ctx,
        },
        env.relatorSentry
      );
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      return new Response(`Erro ao buscar miniatura: ${mensagem}`, {
        status: 502,
        headers: {
          ...cabecalhosCors,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const metadadosRota = analisarRotaLink(url);
  if (!metadadosRota) {
    return responderHtml(
      renderizarPaginaNaoEncontrada(),
      404,
      `public, max-age=300, s-maxage=${TTL_BORDA_UM_ANO_SEGUNDOS}`
    );
  }

  if (!env.DB) return responderErroBancoAusente(req, env, ctx);

  try {
    const entidade = await resolverEntidadePorUid(env.DB, metadadosRota.uid);
    if (!entidade) {
      return responderHtml(
        renderizarPaginaNaoEncontrada(),
        404,
        `public, max-age=300, s-maxage=${TTL_BORDA_UM_DIA_SEGUNDOS}`
      );
    }

    const urlCanonica = construirUrlCanonicaVitrine(entidade);
    const urlDestino = construirUrlRedirecionamentoArestaCc(
      url,
      metadadosRota,
      urlCanonica
    );
    return responderRedirecionamento(
      urlDestino,
      301,
      CABECALHO_CACHE_REDIRECIONAMENTO_LONGO
    );
  } catch (erro: unknown) {
    return responderErroConsultaD1(erro, req, env, ctx);
  }
}

export function criarOpcoesSentry(env: AmbienteAppLinks) {
  return {
    dsn: env.SENTRY_DSN,
    beforeSend(event: Sentry.ErrorEvent) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["x-api-key"];
      }
      return event;
    },
  };
}

export default Sentry.withSentry(criarOpcoesSentry, {
  fetch(
    req: Request,
    env: AmbienteAppLinks,
    ctx?: ContextoExecucaoAssincrona
  ): Promise<Response> {
    return processarRequisicao(req, env, ctx);
  },
});
