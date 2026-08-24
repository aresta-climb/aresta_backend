// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface DadosUsuarioAutenticado {
  idUsuario: string;
  email: string;
  nomeCompleto: string;
}

export interface RegistroBranchSugestao {
  id: string;
  branch_name: string;
  author_id: string | null;
  author_email: string;
  author_name: string;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
}

export function extrairChaveSecretaSupabase(): string {
  const chavesSecretas = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!chavesSecretas) {
    return "";
  }
  try {
    const analisado = JSON.parse(chavesSecretas);
    if (typeof analisado === "object" && analisado !== null) {
      return (
        analisado.default ||
        analisado.service_role ||
        Object.values(analisado)[0] ||
        ""
      );
    } else if (typeof analisado === "string") {
      return analisado;
    }
  } catch {
    return chavesSecretas;
  }
  return "";
}

export function obterClienteSupabaseAdmin(): SupabaseClient {
  const urlSupabase = Deno.env.get("SUPABASE_URL") ?? "";
  const chaveSecreta = extrairChaveSecretaSupabase();
  return createClient(urlSupabase, chaveSecreta);
}

export async function validarTokenJwt(
  token: string,
  clientePersonalizado?: SupabaseClient,
): Promise<DadosUsuarioAutenticado | null> {
  const cliente = clientePersonalizado ?? obterClienteSupabaseAdmin();
  const tokenLimpo = token.replace(/^Bearer\s+/i, "").trim();

  const { data, error } = await cliente.auth.getUser(tokenLimpo);
  if (error || !data?.user) {
    return null;
  }

  const usuario = data.user;
  const email = usuario.email ?? "";
  const nomeCompleto =
    usuario.user_metadata?.nome_completo ||
    usuario.user_metadata?.full_name ||
    usuario.user_metadata?.name ||
    email.split("@")[0] ||
    "Colaborador Aresta";

  return {
    idUsuario: usuario.id,
    email,
    nomeCompleto,
  };
}

export async function obterRegistroBranch(
  nomeBranch: string,
  clientePersonalizado?: SupabaseClient,
): Promise<RegistroBranchSugestao | null> {
  const cliente = clientePersonalizado ?? obterClienteSupabaseAdmin();

  const { data, error } = await cliente
    .from("sugestoes_branches")
    .select("*")
    .eq("branch_name", nomeBranch)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as RegistroBranchSugestao;
}

export async function registrarNovaBranch(
  dados: {
    branchName: string;
    authorId: string | null;
    authorEmail: string;
    authorName: string;
  },
  clientePersonalizado?: SupabaseClient,
): Promise<RegistroBranchSugestao | null> {
  const cliente = clientePersonalizado ?? obterClienteSupabaseAdmin();

  const { data, error } = await cliente
    .from("sugestoes_branches")
    .insert({
      branch_name: dados.branchName,
      author_id: dados.authorId,
      author_email: dados.authorEmail,
      author_name: dados.authorName,
      status: "aberta",
    })
    .select()
    .single();

  if (error) {
    return null;
  }

  return data as RegistroBranchSugestao;
}

export async function atualizarMetadadosPr(
  nomeBranch: string,
  dadosPr: { prNumber: number; prUrl: string },
  clientePersonalizado?: SupabaseClient,
): Promise<boolean> {
  const cliente = clientePersonalizado ?? obterClienteSupabaseAdmin();

  const { error } = await cliente
    .from("sugestoes_branches")
    .update({
      pr_number: dadosPr.prNumber,
      pr_url: dadosPr.prUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("branch_name", nomeBranch);

  return !error;
}
