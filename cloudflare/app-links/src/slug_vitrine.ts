// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { MetadadosRotaLink } from "../../../aresta_api/openapi/generated/ts/app_links.ts";

export const DOMINIO_VITRINE_CANONICO = "https://arestaclimb.com";

/**
 * Dados mínimos de uma entidade necessários para construir seu slug e URL canônica.
 */
export interface EntidadeSlugificavel {
  uid: string;
  tipo: "croqui" | "grupo" | "setor" | "escalada";
  nome: string;
  croqui_nome: string;
  cidade?: string | null;
  estado?: string | null;
}

/**
 * Normaliza um texto arbitrário em um slug URL-safe minúsculo sem acentos,
 * retornando `"item"` caso o texto não contenha nenhum caractere alfanumérico.
 */
export function slugificarTexto(texto: string): string {
  const limpo = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return limpo || "item";
}

/**
 * Constrói o slug canônico legível para SEO a partir dos metadados da entidade,
 * combinando estado, cidade/croqui e nome sem duplicar a cidade quando já presente no título do croqui.
 */
export function construirSlugCanonicoEntidade(
  entidade: Omit<EntidadeSlugificavel, "uid">
): string {
  const partes: string[] = [];
  if (entidade.estado && entidade.estado.trim()) {
    partes.push(entidade.estado.trim());
  }

  if (entidade.tipo === "croqui") {
    const slugNome = slugificarTexto(entidade.nome);
    const slugCidade = entidade.cidade ? slugificarTexto(entidade.cidade) : "";
    if (slugCidade && slugCidade !== "item" && !slugNome.includes(slugCidade)) {
      partes.push(entidade.cidade!);
    }
    partes.push(entidade.nome);
  } else {
    partes.push(entidade.croqui_nome);
    partes.push(entidade.nome);
  }

  return slugificarTexto(partes.join(" "));
}

/**
 * Retorna o caminho relativo canônico da vitrine com os 14 caracteres do UID na frente (`/croquis/<uid>/<slug>`).
 */
export function construirCaminhoVitrineEntidade(
  uid: string,
  slug: string
): string {
  return `/croquis/${uid}/${slug}`;
}

/**
 * Retorna a URL absoluta canônica (`https://arestaclimb.com/croquis/<uid>/<slug>`) de uma entidade.
 */
export function construirUrlCanonicaVitrine(
  entidade: EntidadeSlugificavel
): string {
  const slug = construirSlugCanonicoEntidade(entidade);
  return `${DOMINIO_VITRINE_CANONICO}${construirCaminhoVitrineEntidade(entidade.uid, slug)}`;
}

/**
 * Constrói a URL de destino do redirect `301` de `aresta.cc`, preservando todos os CGI args
 * originais da URL e adicionando `mapa=1` e `utm_source`/`utm_medium` derivados do prefixo
 * quando ainda não especificados explicitamente na query string.
 */
export function construirUrlRedirecionamentoArestaCc(
  urlOriginal: URL,
  rota: MetadadosRotaLink,
  urlCanonicaBase: string
): string {
  const destino = new URL(urlCanonicaBase);
  for (const [chave, valor] of urlOriginal.searchParams.entries()) {
    destino.searchParams.append(chave, valor);
  }
  if (rota.abrir_mapa && !destino.searchParams.has("mapa")) {
    destino.searchParams.set("mapa", "1");
  }
  if (rota.utm_source && !destino.searchParams.has("utm_source")) {
    destino.searchParams.set("utm_source", rota.utm_source);
  }
  if (rota.utm_medium && !destino.searchParams.has("utm_medium")) {
    destino.searchParams.set("utm_medium", rota.utm_medium);
  }
  return destino.toString();
}

/**
 * Resolve o link externo do Google Maps de um croqui, priorizando `url_google_maps` explícita (http/https)
 * e fazendo fallback para busca por coordenadas geográficas (`latitude_e7 / 1e7, longitude_e7 / 1e7`).
 */
export function resolverUrlGoogleMapsCroqui(dados: {
  latitude_e7?: number | null;
  longitude_e7?: number | null;
  url_google_maps?: string | null;
}): string | null {
  const urlDireta = dados.url_google_maps?.trim() ?? "";
  if (/^https?:\/\//i.test(urlDireta)) {
    return urlDireta;
  }

  const latE7 = dados.latitude_e7 ?? null;
  const lonE7 = dados.longitude_e7 ?? null;
  if (latE7 !== null && lonE7 !== null && (latE7 !== 0 || lonE7 !== 0)) {
    const lat = Number((latE7 / 1e7).toFixed(6));
    const lon = Number((lonE7 / 1e7).toFixed(6));
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  }

  return null;
}
