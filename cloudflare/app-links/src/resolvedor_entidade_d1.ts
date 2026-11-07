// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { ResumoEntidadeLink } from "../../../aresta_api/openapi/generated/ts/app_links.ts";

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
  setor_nome: string | null;
  grupo_nome: string | null;
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
  NULL AS setor_nome,
  NULL AS grupo_nome
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
  TRIM(s.nome) AS setor_nome,
  TRIM(g.nome) AS grupo_nome
FROM catalogo_aresta e
JOIN catalogo_croquis c ON c.croqui_uid = e.croqui_uid
LEFT JOIN catalogo_aresta s ON s.uid = e.setor_uid
LEFT JOIN catalogo_aresta g ON g.uid = e.grupo_uid
WHERE e.uid = ?1
  AND e.tipo IN ('grupo', 'setor', 'escalada')
LIMIT 1
`.trim();

/**
 * Resolve um UID canônico de 14 caracteres no banco Cloudflare D1 (`aresta-catalogo`),
 * consultando em uma única query unificada (`UNION ALL`) as tabelas `catalogo_croquis`
 * e `catalogo_aresta` (com `JOIN` para croqui, setor pai e grupo pai) para minimizar
 * a latência de round-trip na borda.
 *
 * Retorna `null` caso o UID não pertença a nenhum croqui, grupo, setor ou escalada.
 */
export async function resolverEntidadePorUid(
  db: BancoD1,
  uid: string
): Promise<ResumoEntidadeLink | null> {
  const resultadoEntidade = await db
    .prepare(SQL_BUSCAR_ENTIDADE_OU_CROQUI_POR_UID)
    .bind(uid)
    .all<LinhaEntidadeQuery>();

  if (resultadoEntidade.results.length === 0) {
    return null;
  }

  const entidade = resultadoEntidade.results[0];
  return {
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
    setor_nome: entidade.setor_nome || null,
    grupo_nome: entidade.grupo_nome || null,
  };
}
