// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { MetadadosRotaLink } from "../../../aresta_api/openapi/generated/ts/app_links.ts";

/**
 * Expressão regular para validar UIDs canônicos do Aresta (14 caracteres alfanuméricos).
 * Evita consultas desnecessárias ao Cloudflare D1 para caminhos arbitrários ou bots.
 */
const REGEX_UID_CANONICO = /^[A-Za-z0-9]{14}$/;

/**
 * Configuração derivada de cada prefixo curto suportado em `aresta.cc`.
 */
interface ConfiguracaoPrefixo {
  abrir_mapa: boolean;
  origem_link: "compartilhamento" | "qrcode" | null;
  utm_source_padrao: string | null;
  utm_medium_padrao: string | null;
}

const PREFIXOS_SUPORTADOS: Record<string, ConfiguracaoPrefixo> = {
  m: {
    abrir_mapa: true,
    origem_link: null,
    utm_source_padrao: null,
    utm_medium_padrao: null,
  },
  s: {
    abrir_mapa: false,
    origem_link: "compartilhamento",
    utm_source_padrao: "compartilhamento",
    utm_medium_padrao: "social",
  },
  sm: {
    abrir_mapa: true,
    origem_link: "compartilhamento",
    utm_source_padrao: "compartilhamento",
    utm_medium_padrao: "social",
  },
  ms: {
    abrir_mapa: true,
    origem_link: "compartilhamento",
    utm_source_padrao: "compartilhamento",
    utm_medium_padrao: "social",
  },
  q: {
    abrir_mapa: false,
    origem_link: "qrcode",
    utm_source_padrao: "placa_rocha",
    utm_medium_padrao: "qrcode",
  },
  qm: {
    abrir_mapa: true,
    origem_link: "qrcode",
    utm_source_padrao: "placa_rocha",
    utm_medium_padrao: "qrcode",
  },
  mq: {
    abrir_mapa: true,
    origem_link: "qrcode",
    utm_source_padrao: "placa_rocha",
    utm_medium_padrao: "qrcode",
  },
};

/**
 * Analisa uma URL de App Link (`https://aresta.cc/...`) e extrai o UID da entidade,
 * o prefixo de contexto (`m`, `s`, `sm`, `ms`, `q`, `qm`, `mq`), a flag de abertura no mapa
 * e os parâmetros UTM para telemetria no Umami.
 *
 * Retorna `null` se o caminho não corresponder ao formato `/<uid>` ou `/<prefixo>/<uid>`
 * com UID alfanumérico de 14 caracteres.
 */
export function analisarRotaLink(url: URL): MetadadosRotaLink | null {
  const segmentos = url.pathname
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let prefixo: string | null = null;
  let uid: string;
  let configPrefixo: ConfiguracaoPrefixo = {
    abrir_mapa: false,
    origem_link: null,
    utm_source_padrao: null,
    utm_medium_padrao: null,
  };

  if (segmentos.length === 1) {
    uid = segmentos[0];
  } else if (segmentos.length === 2) {
    const candidatoPrefixo = segmentos[0];
    const configEncontrada = PREFIXOS_SUPORTADOS[candidatoPrefixo];
    if (!configEncontrada) {
      return null;
    }
    prefixo = candidatoPrefixo;
    configPrefixo = configEncontrada;
    uid = segmentos[1];
  } else {
    return null;
  }

  if (!REGEX_UID_CANONICO.test(uid)) {
    return null;
  }

  const utmSourceQuery = url.searchParams.get("utm_source")?.trim() || null;
  const utmMediumQuery = url.searchParams.get("utm_medium")?.trim() || null;

  return {
    uid,
    prefixo,
    abrir_mapa: configPrefixo.abrir_mapa,
    origem_link: configPrefixo.origem_link,
    utm_source: utmSourceQuery ?? configPrefixo.utm_source_padrao,
    utm_medium: utmMediumQuery ?? configPrefixo.utm_medium_padrao,
  };
}
