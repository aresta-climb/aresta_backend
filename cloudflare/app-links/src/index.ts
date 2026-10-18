// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ROTA_OBTER_ASSETLINKS_ANDROID,
  ROTA_OBTER_ASSOCIACAO_IOS,
  ROTA_VERIFICAR_SAUDE_APP_LINKS,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";
import { analisarRotaLink } from "./analisador_rota_link.ts";
import {
  renderizarPaginaEntidade,
  renderizarPaginaNaoEncontrada,
} from "./renderizador_pagina_link.ts";
import { BancoD1, resolverEntidadePorUid } from "./resolvedor_entidade_d1.ts";

/**
 * Interface com os bindings de ambiente do Worker `aresta-app-links` (`aresta.cc`).
 */
export interface AmbienteAppLinks {
  DB?: BancoD1;
}

const URL_SITE_PRINCIPAL = "https://arestaclimb.com";

export const cabecalhosCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Cabeçalho de cache para arquivos `.well-known` (24 horas no navegador e na borda).
 */
export const CABECALHO_CACHE_WELL_KNOWN =
  "public, max-age=86400, s-maxage=86400";

/**
 * Cabeçalho de cache para páginas HTML SSR de App Links (1 hora no navegador, 24 horas na CDN).
 */
export const CABECALHO_CACHE_PAGINA_LINK =
  "public, max-age=3600, s-maxage=86400";

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

/**
 * Roteador principal do Worker `aresta-app-links` (`https://aresta.cc`).
 */
export async function processarRequisicao(
  req: Request,
  env: AmbienteAppLinks = {}
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
    return new Response(null, {
      status: 301,
      headers: {
        ...cabecalhosCors,
        Location: `https://aresta.cc${url.pathname}${url.search}`,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
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

  if (caminho === "/") {
    return new Response(null, {
      status: 302,
      headers: {
        ...cabecalhosCors,
        Location: URL_SITE_PRINCIPAL,
        "Cache-Control": "public, max-age=3600",
      },
    });
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

  const metadadosRota = analisarRotaLink(url);
  if (!metadadosRota) {
    return responderHtml(
      renderizarPaginaNaoEncontrada(),
      404,
      "public, max-age=300, s-maxage=300"
    );
  }

  if (!env.DB) {
    return new Response("Binding DB do Cloudflare D1 não configurado", {
      status: 500,
      headers: {
        ...cabecalhosCors,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const entidade = await resolverEntidadePorUid(env.DB, metadadosRota.uid);
    if (!entidade) {
      return responderHtml(
        renderizarPaginaNaoEncontrada(),
        404,
        "public, max-age=300, s-maxage=300"
      );
    }

    const html = renderizarPaginaEntidade(entidade, metadadosRota);
    return responderHtml(html, 200, CABECALHO_CACHE_PAGINA_LINK);
  } catch (erro: unknown) {
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
}

export default {
  fetch(req: Request, env: AmbienteAppLinks): Promise<Response> {
    return processarRequisicao(req, env);
  },
};
