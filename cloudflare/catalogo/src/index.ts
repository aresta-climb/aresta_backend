// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  CatalogoCroqui,
  CatalogoEntidade,
  DeletesSyncCatalogo,
  ErroCatalogo,
  RespostaSyncCatalogo,
  ROTA_SINCRONIZAR_CATALOGO,
  ROTA_VERIFICAR_SAUDE_CATALOGO,
  UpsertsSyncCatalogo,
} from "../../../aresta_api/openapi/generated/ts/catalogo.ts";
import { LinhaDeltasCatalogo } from "../../../aresta_api/sql/generated/ts/catalogo_d1_sql.ts";

/**
 * Interface mínima para statement preparado do Cloudflare D1.
 */
export interface DeclaracaoPreparadaD1 {
  bind(...valores: unknown[]): DeclaracaoPreparadaD1;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/**
 * Interface mínima do binding D1 injetado pelo Cloudflare Workers.
 */
export interface BancoD1 {
  prepare(query: string): DeclaracaoPreparadaD1;
}

/**
 * Interface com as variáveis e bindings de ambiente do Worker do Catálogo.
 */
export interface AmbienteCatalogo {
  DB?: BancoD1;
}

/**
 * Estrutura de uma linha da tabela deltas_catalogo no Cloudflare D1.
 */
export type RegistroDeltaD1 = Pick<
  Required<LinhaDeltasCatalogo>,
  "id" | "versao_hash" | "upserts_json" | "deletes_json"
>;

const TTL_CACHE_SEGUNDOS = 31536000;

export const cabecalhosCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Cabeçalho de cache imutável de 1 ano para pares determinísticos (versao_local, versao_destino).
 * Retido diretamente na camada de CDN da Cloudflare via Cache Rule, sem invocar o Worker em cache hits.
 */
export const CABECALHO_CACHE_IMUTAVEL = `public, max-age=${TTL_CACHE_SEGUNDOS}, s-maxage=${TTL_CACHE_SEGUNDOS}, immutable`;

/**
 * Condensa (Delta Squash) múltiplos deltas sequenciais em um único conjunto final de upserts e deletes.
 * O campo 'entidades' armazena as entidades de catalogo_aresta (escaladas, setores, grupos e botões),
 * normalizadas e unificadas sob o identificador único 'uid'.
 */
export function condensarDeltas(deltas: RegistroDeltaD1[]): {
  upserts: UpsertsSyncCatalogo;
  deletes: DeletesSyncCatalogo;
} {
  const croquisUpsert = new Map<string, CatalogoCroqui>();
  const croquisDelete = new Set<string>();
  const entidadesUpsert = new Map<string, CatalogoEntidade>();
  const entidadesDelete = new Set<string>();

  for (const delta of deltas) {
    const deletesObj = JSON.parse(
      delta.deletes_json
    ) as Partial<DeletesSyncCatalogo>;
    const upsertsObj = JSON.parse(
      delta.upserts_json
    ) as Partial<UpsertsSyncCatalogo>;

    for (const croquiUid of deletesObj.croquis ?? []) {
      croquisUpsert.delete(croquiUid);
      croquisDelete.add(croquiUid);
    }

    for (const entidadeUid of deletesObj.entidades ?? []) {
      entidadesUpsert.delete(entidadeUid);
      entidadesDelete.add(entidadeUid);
    }

    for (const croqui of upsertsObj.croquis ?? []) {
      const uid = String(croqui.croqui_uid);
      croquisDelete.delete(uid);
      croquisUpsert.set(uid, croqui);
    }

    for (const entidade of upsertsObj.entidades ?? []) {
      const uid = String(entidade.uid);
      entidadesDelete.delete(uid);
      entidadesUpsert.set(uid, entidade);
    }
  }

  return {
    upserts: {
      croquis: Array.from(croquisUpsert.values()),
      entidades: Array.from(entidadesUpsert.values()),
    },
    deletes: {
      croquis: Array.from(croquisDelete.values()),
      entidades: Array.from(entidadesDelete.values()),
    },
  };
}

function responderJson(
  corpo: RespostaSyncCatalogo | ErroCatalogo,
  status: number,
  cacheControl: string
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...cabecalhosCors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * Roteador principal do Worker de Sincronização do Catálogo (catalogo.arestaclimb.com).
 */
export async function processarRequisicao(
  req: Request,
  env: AmbienteCatalogo = {}
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

  if (caminho === "/" || caminho === ROTA_VERIFICAR_SAUDE_CATALOGO) {
    return new Response("Aresta Catálogo Gateway operacional", {
      status: 200,
      headers: {
        ...cabecalhosCors,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (caminho === ROTA_SINCRONIZAR_CATALOGO) {
    const versaoLocal = url.searchParams.get("versao_local")?.trim() || "";
    const versaoDestino = url.searchParams.get("versao_destino")?.trim() || "";

    if (!versaoLocal || !versaoDestino) {
      return responderJson(
        { erro: "Parâmetros versao_local e versao_destino são obrigatórios" },
        400,
        "no-store"
      );
    }

    if (versaoLocal === versaoDestino) {
      return responderJson(
        {
          acao: "apply_delta",
          versao_atual: versaoDestino,
          total_deltas: 0,
          upserts: { croquis: [], entidades: [] },
          deletes: { croquis: [], entidades: [] },
        },
        200,
        CABECALHO_CACHE_IMUTAVEL
      );
    }

    if (!env.DB) {
      return responderJson(
        { erro: "Binding DB do Cloudflare D1 não configurado" },
        500,
        "no-store"
      );
    }

    try {
      const consultaVersoes = await env.DB.prepare(
        "SELECT id, versao_hash FROM deltas_catalogo WHERE versao_hash IN (?, ?)"
      )
        .bind(versaoLocal, versaoDestino)
        .all<{ id: number; versao_hash: string }>();

      const mapaIds = new Map<string, number>();
      for (const linha of consultaVersoes.results) {
        mapaIds.set(linha.versao_hash, Number(linha.id));
      }

      const idLocal = mapaIds.get(versaoLocal);
      const idDestino = mapaIds.get(versaoDestino);

      if (
        idLocal === undefined ||
        idDestino === undefined ||
        idLocal > idDestino
      ) {
        return responderJson(
          {
            acao: "full_download",
            versao_atual: versaoDestino,
          },
          200,
          "no-store"
        );
      }

      const consultaDeltas = await env.DB.prepare(
        "SELECT id, versao_hash, upserts_json, deletes_json FROM deltas_catalogo WHERE id > ? AND id <= ? ORDER BY id ASC"
      )
        .bind(idLocal, idDestino)
        .all<RegistroDeltaD1>();

      const condensado = condensarDeltas(consultaDeltas.results);

      return responderJson(
        {
          acao: "apply_delta",
          versao_atual: versaoDestino,
          total_deltas: consultaDeltas.results.length,
          upserts: condensado.upserts,
          deletes: condensado.deletes,
        },
        200,
        CABECALHO_CACHE_IMUTAVEL
      );
    } catch (erro: unknown) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      return responderJson(
        { erro: `Erro ao consultar deltas no D1: ${mensagem}` },
        500,
        "no-store"
      );
    }
  }

  return new Response("Não encontrado", {
    status: 404,
    headers: { ...cabecalhosCors, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  fetch(req: Request, env: AmbienteCatalogo): Promise<Response> {
    return processarRequisicao(req, env);
  },
};
