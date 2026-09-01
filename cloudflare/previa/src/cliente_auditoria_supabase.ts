// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { DadosInicioSessao, DadosFimSessao } from "./tipos.ts";

export interface ContextoAuditoria {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  executarFetch?: typeof fetch;
}

/**
 * Registra o início de uma nova sessão de prévia na tabela auditoria_sessoes_previa do Supabase.
 * Retorna o UUID da linha inserida ou null em caso de falha.
 */
export async function registrarInicioSessao(
  dados: DadosInicioSessao,
  contexto?: ContextoAuditoria,
): Promise<string | null> {
  const supabaseUrl =
    contexto?.SUPABASE_URL ||
    (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_URL") : undefined);
  const serviceKey =
    contexto?.SUPABASE_SERVICE_ROLE_KEY ||
    (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") : undefined);
  const fetchFn = contexto?.executarFetch || fetch;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/auditoria_sessoes_previa`;

  const payload = {
    usuario_id: dados.usuarioId,
    usuario_email: dados.usuarioEmail,
    codigo: dados.codigo,
    url_previa: dados.urlPrevia,
    ip_origem: dados.ipOrigem || null,
    ip_local: dados.ipLocal || null,
    porta_local: dados.portaLocal || null,
    user_agent: dados.userAgent || null,
    iniciado_em: new Date().toISOString(),
  };

  try {
    const resposta = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });

    if (!resposta.ok) {
      console.warn(`[Auditoria] Falha ao registrar início da sessão: HTTP ${resposta.status}`);
      return null;
    }

    const resultado = (await resposta.json()) as any[];
    if (Array.isArray(resultado) && resultado.length > 0 && resultado[0].id) {
      return resultado[0].id;
    }
    return null;
  } catch (erro) {
    console.warn(`[Auditoria] Erro ao conectar ao Supabase: ${erro}`);
    return null;
  }
}

/**
 * Atualiza o registro da sessão na tabela auditoria_sessoes_previa com os dados de término e duração.
 */
export async function registrarFimSessao(
  idOuCodigo: string,
  dados: DadosFimSessao,
  contexto?: ContextoAuditoria,
): Promise<boolean> {
  const supabaseUrl =
    contexto?.SUPABASE_URL ||
    (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_URL") : undefined);
  const serviceKey =
    contexto?.SUPABASE_SERVICE_ROLE_KEY ||
    (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") : undefined);
  const fetchFn = contexto?.executarFetch || fetch;

  if (!supabaseUrl || !serviceKey || !idOuCodigo) {
    return false;
  }

  // Verifica se o identificador é um UUID ou o código de sessão
  const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOuCodigo);
  const queryParam = ehUuid ? `id=eq.${idOuCodigo}` : `codigo=eq.${idOuCodigo}&encerrado_em=is.null`;
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/auditoria_sessoes_previa?${queryParam}`;

  const payload = {
    encerrado_em: dados.encerradoEm,
    duracao_segundos: dados.duracaoSegundos,
    motivo_encerramento: dados.motivoEncerramento,
  };

  try {
    const resposta = await fetchFn(endpoint, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
    });

    return resposta.ok;
  } catch (erro) {
    console.warn(`[Auditoria] Erro ao registrar término de sessão no Supabase: ${erro}`);
    return false;
  }
}
