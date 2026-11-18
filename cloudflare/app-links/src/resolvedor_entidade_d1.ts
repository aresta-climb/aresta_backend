// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ItemBuscaVitrine,
  ResumoCroquiVitrine,
  ResumoEntidadeLink,
  SubentidadeVitrine,
} from "../../../aresta_api/openapi/generated/ts/app_links.ts";
import { construirSlugCanonicoEntidade } from "./slug_vitrine.ts";

/**
 * Interface de statement preparado compatível com o binding D1 do Cloudflare Workers.
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

export interface OpcoesResolucaoEntidade {
  incluirSubentidades?: boolean;
}

interface LinhaEntidadeQuery {
  uid: string;
  tipo: "croqui" | "grupo" | "setor" | "escalada";
  nome: string;
  croqui_uid: string;
  id_slug: string;
  croqui_nome: string;
  cidade: string | null;
  estado: string | null;
  escalada_grau: string | null;
  escalada_tipo: string | null;
  setor_uid: string | null;
  setor_nome: string | null;
  grupo_uid: string | null;
  grupo_nome: string | null;
  latitude_e7: number | null;
  longitude_e7: number | null;
  url_google_maps: string | null;
}

interface LinhaSubentidadeQuery {
  uid: string;
  tipo: "grupo" | "setor" | "escalada";
  nome: string;
  escalada_grau: string | null;
  escalada_tipo: string | null;
  setor_uid: string | null;
  setor_nome: string | null;
  grupo_uid: string | null;
  grupo_nome: string | null;
}

interface LinhaCroquiAgregadoQuery {
  croqui_uid: string;
  id_slug: string;
  nome: string;
  cidade: string | null;
  estado: string | null;
  latitude_e7: number | null;
  longitude_e7: number | null;
  url_google_maps: string | null;
  total_setores: number | null;
  total_escaladas: number | null;
}

interface LinhaBuscaGlobalQuery {
  uid: string;
  tipo: "croqui" | "grupo" | "setor" | "escalada";
  nome: string;
  croqui_nome: string;
  cidade: string | null;
  estado: string | null;
  escalada_grau: string | null;
  escalada_tipo: string | null;
}

const SQL_BUSCAR_ENTIDADE_OU_CROQUI_POR_UID = `
SELECT
  c.croqui_uid AS uid,
  'croqui' AS tipo,
  TRIM(c.nome) AS nome,
  c.croqui_uid AS croqui_uid,
  c.id_slug AS id_slug,
  TRIM(c.nome) AS croqui_nome,
  TRIM(c.cidade) AS cidade,
  TRIM(c.estado) AS estado,
  NULL AS escalada_grau,
  NULL AS escalada_tipo,
  NULL AS setor_uid,
  NULL AS setor_nome,
  NULL AS grupo_uid,
  NULL AS grupo_nome,
  c.latitude_e7 AS latitude_e7,
  c.longitude_e7 AS longitude_e7,
  TRIM(c.url_google_maps) AS url_google_maps
FROM catalogo_croquis c
WHERE c.croqui_uid = ?1
UNION ALL
SELECT
  e.uid AS uid,
  e.tipo AS tipo,
  TRIM(e.nome) AS nome,
  e.croqui_uid AS croqui_uid,
  c.id_slug AS id_slug,
  TRIM(c.nome) AS croqui_nome,
  TRIM(c.cidade) AS cidade,
  TRIM(c.estado) AS estado,
  TRIM(e.escalada_grau) AS escalada_grau,
  TRIM(e.escalada_tipo) AS escalada_tipo,
  e.setor_uid AS setor_uid,
  TRIM(s.nome) AS setor_nome,
  e.grupo_uid AS grupo_uid,
  TRIM(g.nome) AS grupo_nome,
  c.latitude_e7 AS latitude_e7,
  c.longitude_e7 AS longitude_e7,
  TRIM(c.url_google_maps) AS url_google_maps
FROM catalogo_aresta e
JOIN catalogo_croquis c ON c.croqui_uid = e.croqui_uid
LEFT JOIN catalogo_aresta s ON s.uid = e.setor_uid
LEFT JOIN catalogo_aresta g ON g.uid = e.grupo_uid
WHERE e.uid = ?1
  AND e.tipo IN ('grupo', 'setor', 'escalada')
LIMIT 1
`.trim();

const SQL_SUBENTIDADES_CROQUI = `
SELECT
  e.uid AS uid,
  e.tipo AS tipo,
  TRIM(e.nome) AS nome,
  NULL AS escalada_grau,
  NULL AS escalada_tipo,
  NULL AS setor_uid,
  NULL AS setor_nome,
  e.grupo_uid AS grupo_uid,
  TRIM(g.nome) AS grupo_nome
FROM catalogo_aresta e
LEFT JOIN catalogo_aresta g ON g.uid = e.grupo_uid
WHERE e.croqui_uid = ?1
  AND e.tipo IN ('grupo', 'setor')
ORDER BY CASE WHEN e.tipo = 'grupo' THEN 0 ELSE 1 END, TRIM(e.nome) COLLATE NOCASE
`.trim();

const SQL_SUBENTIDADES_GRUPO = `
SELECT
  e.uid AS uid,
  e.tipo AS tipo,
  TRIM(e.nome) AS nome,
  NULL AS escalada_grau,
  NULL AS escalada_tipo,
  NULL AS setor_uid,
  NULL AS setor_nome,
  e.grupo_uid AS grupo_uid,
  NULL AS grupo_nome
FROM catalogo_aresta e
WHERE e.grupo_uid = ?1
  AND e.tipo = 'setor'
ORDER BY TRIM(e.nome) COLLATE NOCASE
`.trim();

const SQL_SUBENTIDADES_SETOR = `
SELECT
  e.uid AS uid,
  e.tipo AS tipo,
  TRIM(e.nome) AS nome,
  TRIM(e.escalada_grau) AS escalada_grau,
  TRIM(e.escalada_tipo) AS escalada_tipo,
  e.setor_uid AS setor_uid,
  NULL AS setor_nome,
  e.grupo_uid AS grupo_uid,
  NULL AS grupo_nome
FROM catalogo_aresta e
WHERE e.setor_uid = ?1
  AND e.tipo = 'escalada'
ORDER BY TRIM(e.nome) COLLATE NOCASE
`.trim();

const SQL_LISTAR_CROQUIS_VITRINE = `
SELECT
  c.croqui_uid AS croqui_uid,
  c.id_slug AS id_slug,
  TRIM(c.nome) AS nome,
  TRIM(c.cidade) AS cidade,
  TRIM(c.estado) AS estado,
  c.latitude_e7 AS latitude_e7,
  c.longitude_e7 AS longitude_e7,
  TRIM(c.url_google_maps) AS url_google_maps,
  SUM(CASE WHEN e.tipo = 'setor' THEN 1 ELSE 0 END) AS total_setores,
  SUM(CASE WHEN e.tipo = 'escalada' THEN 1 ELSE 0 END) AS total_escaladas
FROM catalogo_croquis c
LEFT JOIN catalogo_aresta e ON e.croqui_uid = c.croqui_uid
GROUP BY c.croqui_uid
ORDER BY COALESCE(NULLIF(TRIM(c.estado), ''), 'ZZ'), TRIM(c.nome) COLLATE NOCASE
`.trim();

const SQL_LISTAR_ITENS_BUSCA_E_SITEMAP = `
SELECT
  c.croqui_uid AS uid,
  'croqui' AS tipo,
  TRIM(c.nome) AS nome,
  TRIM(c.nome) AS croqui_nome,
  TRIM(c.cidade) AS cidade,
  TRIM(c.estado) AS estado,
  NULL AS escalada_grau,
  NULL AS escalada_tipo
FROM catalogo_croquis c
UNION ALL
SELECT
  e.uid AS uid,
  e.tipo AS tipo,
  TRIM(e.nome) AS nome,
  TRIM(c.nome) AS croqui_nome,
  TRIM(c.cidade) AS cidade,
  TRIM(c.estado) AS estado,
  TRIM(e.escalada_grau) AS escalada_grau,
  TRIM(e.escalada_tipo) AS escalada_tipo
FROM catalogo_aresta e
JOIN catalogo_croquis c ON c.croqui_uid = e.croqui_uid
WHERE e.tipo IN ('grupo', 'setor', 'escalada')
`.trim();

function formatarCidadeEstado(
  cidade: string | null,
  estado: string | null
): string | null {
  const c = cidade || null;
  const uf = estado || null;
  if (c && uf) return `${c} - ${uf}`;
  return c || uf;
}

async function consultarSubentidades(
  db: BancoD1,
  tipoPai: "croqui" | "grupo" | "setor",
  uidPai: string
): Promise<SubentidadeVitrine[]> {
  const sql =
    tipoPai === "croqui"
      ? SQL_SUBENTIDADES_CROQUI
      : tipoPai === "grupo"
        ? SQL_SUBENTIDADES_GRUPO
        : SQL_SUBENTIDADES_SETOR;

  const resultado = await db
    .prepare(sql)
    .bind(uidPai)
    .all<LinhaSubentidadeQuery>();

  return resultado.results.map((linha) => ({
    uid: linha.uid,
    tipo: linha.tipo,
    nome: linha.nome,
    escalada_grau: linha.escalada_grau || null,
    escalada_tipo: linha.escalada_tipo || null,
    setor_uid: linha.setor_uid || null,
    setor_nome: linha.setor_nome || null,
    grupo_uid: linha.grupo_uid || null,
    grupo_nome: linha.grupo_nome || null,
  }));
}

/**
 * Resolve um UID canônico de 14 caracteres no banco Cloudflare D1 (`aresta-catalogo`).
 * Quando `opcoes.incluirSubentidades` for `true`, carrega também os filhos imediatos
 * para croquis, grupos e setores.
 */
export async function resolverEntidadePorUid(
  db: BancoD1,
  uid: string,
  opcoes: OpcoesResolucaoEntidade = {}
): Promise<ResumoEntidadeLink | null> {
  const resultadoEntidade = await db
    .prepare(SQL_BUSCAR_ENTIDADE_OU_CROQUI_POR_UID)
    .bind(uid)
    .all<LinhaEntidadeQuery>();

  if (resultadoEntidade.results.length === 0) {
    return null;
  }

  const entidade = resultadoEntidade.results[0];
  const base: ResumoEntidadeLink = {
    uid: entidade.uid,
    tipo: entidade.tipo,
    nome: entidade.nome,
    croqui_uid: entidade.croqui_uid,
    id_slug: entidade.id_slug,
    croqui_nome: entidade.croqui_nome,
    cidade: entidade.cidade || null,
    estado: entidade.estado || null,
    escalada_grau: entidade.escalada_grau || null,
    escalada_tipo: entidade.escalada_tipo || null,
    setor_uid: entidade.setor_uid || null,
    setor_nome: entidade.setor_nome || null,
    grupo_uid: entidade.grupo_uid || null,
    grupo_nome: entidade.grupo_nome || null,
    latitude_e7: entidade.latitude_e7 ?? null,
    longitude_e7: entidade.longitude_e7 ?? null,
    url_google_maps: entidade.url_google_maps || null,
  };

  if (opcoes.incluirSubentidades) {
    base.subentidades =
      entidade.tipo === "escalada"
        ? []
        : await consultarSubentidades(db, entidade.tipo, entidade.uid);
  }

  return base;
}

/**
 * Lista todos os croquis com suas coordenadas e totais de setores/escaladas para `/croquis`.
 */
export async function listarCroquisVitrine(
  db: BancoD1
): Promise<ResumoCroquiVitrine[]> {
  const resultado = await db
    .prepare(SQL_LISTAR_CROQUIS_VITRINE)
    .all<LinhaCroquiAgregadoQuery>();

  return resultado.results.map((c) => ({
    croqui_uid: c.croqui_uid,
    id_slug: c.id_slug,
    nome: c.nome,
    cidade: c.cidade || null,
    estado: c.estado || null,
    latitude_e7: c.latitude_e7 ?? null,
    longitude_e7: c.longitude_e7 ?? null,
    url_google_maps: c.url_google_maps || null,
    total_setores: Number(c.total_setores ?? 0),
    total_escaladas: Number(c.total_escaladas ?? 0),
  }));
}

/**
 * Lista todos os croquis, grupos, setores e escaladas pré-formatados com `slug` canônico
 * para alimentar `/croquis/busca.json` e `/croquis/sitemap.xml` em uma única consulta SQL.
 */
export async function listarItensBuscaESitemap(
  db: BancoD1
): Promise<ItemBuscaVitrine[]> {
  const resultado = await db
    .prepare(SQL_LISTAR_ITENS_BUSCA_E_SITEMAP)
    .all<LinhaBuscaGlobalQuery>();

  return resultado.results.map((item) => {
    const cidade = item.cidade || null;
    const estado = item.estado || null;
    return {
      uid: item.uid,
      tipo: item.tipo,
      nome: item.nome,
      grau: item.escalada_grau || null,
      modalidade: item.escalada_tipo || null,
      croqui_nome: item.croqui_nome,
      localizacao: formatarCidadeEstado(cidade, estado),
      slug: construirSlugCanonicoEntidade({
        tipo: item.tipo,
        nome: item.nome,
        croqui_nome: item.croqui_nome,
        cidade,
        estado,
      }),
    };
  });
}
