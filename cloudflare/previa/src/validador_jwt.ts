// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { DadosUsuarioAutenticado } from "./tipos.ts";

export interface ContextoValidacaoJwt {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  executarFetch?: typeof fetch;
}

/**
 * Extrai o token JWT puro de um cabeçalho Authorization (ex: "Bearer <token>").
 */
export function extrairJwtDeCabecalho(cabecalho: string | null): string {
  if (!cabecalho) return "";
  const limpo = cabecalho.trim();
  if (limpo.toLowerCase().startsWith("bearer ")) {
    return limpo.substring(7).trim();
  }
  return limpo;
}

/**
 * Decodifica o payload do token JWT em Base64URL.
 */
export function decodificarPayloadJwt(token: string): any | null {
  try {
    const partes = token.split(".");
    if (partes.length !== 3) return null;

    let payloadB64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payloadB64.length % 4 !== 0) {
      payloadB64 += "=";
    }

    const jsonStr = atob(payloadB64);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Validador rigoroso de JWT de usuário do Supabase.
 * Se o Supabase não estiver configurado no ambiente, a validação FALHA obrigatoriamente (retorna null).
 */
export async function validarTokenJwt(
  tokenOuCabecalho: string | null,
  ambiente?: ContextoValidacaoJwt,
  validadorPersonalizado?: (token: string) => Promise<DadosUsuarioAutenticado | null>,
): Promise<DadosUsuarioAutenticado | null> {
  const token = extrairJwtDeCabecalho(tokenOuCabecalho);
  if (!token) return null;

  if (validadorPersonalizado) {
    return await validadorPersonalizado(token);
  }

  // 1. Decodificação inicial do payload e checagem de expiração
  const payload = decodificarPayloadJwt(token);
  if (!payload) return null;

  const agoraSegundos = Math.floor(Date.now() / 1000);
  if (payload.exp && typeof payload.exp === "number" && payload.exp < agoraSegundos) {
    return null; // Token expirado
  }

  const supabaseUrl =
    ambiente?.SUPABASE_URL ||
    (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_URL") : undefined);
  const publishableKey =
    ambiente?.SUPABASE_PUBLISHABLE_KEY ||
    (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") : undefined);

  // Se o Supabase NÃO estiver configurado no ambiente, a validação OBRIGATORIAMENTE FALHA
  if (!supabaseUrl || !publishableKey) {
    console.warn(
      "[Validador JWT] Configuração do Supabase ausente (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY). Validação rejeitada.",
    );
    return null;
  }

  const fetchFn = ambiente?.executarFetch || fetch;

  try {
    const resp = await fetchFn(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: publishableKey,
      },
    });

    if (!resp.ok) {
      return null;
    }

    const userJson = (await resp.json()) as any;
    if (!userJson || !userJson.id || !userJson.email) {
      return null;
    }

    return {
      idUsuario: userJson.id,
      email: userJson.email,
      nomeCompleto:
        userJson.user_metadata?.nome_completo ||
        userJson.user_metadata?.full_name ||
        userJson.user_metadata?.name ||
        userJson.email.split("@")[0],
    };
  } catch (erro) {
    console.warn(`[Validador JWT] Erro ao validar JWT no Supabase Auth: ${erro}`);
    return null;
  }
}
