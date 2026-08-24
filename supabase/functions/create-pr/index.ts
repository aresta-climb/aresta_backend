// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { validarNomeBranch } from "../compartilhado/validador_regras_branch.ts";
import { validarEscopoArquivos } from "../compartilhado/validador_escopo_arquivos.ts";
import {
  validarTokenJwt,
  atualizarMetadadosPr,
  DadosUsuarioAutenticado,
} from "../compartilhado/cliente_supabase_controle.ts";
import {
  obterArquivosModificadosBranch,
  excluirBranchRemota,
  criarPullRequestGithub,
} from "../compartilhado/cliente_github_bot.ts";

export interface ContextoCreatePr {
  validarJwt?: (token: string) => Promise<DadosUsuarioAutenticado | null>;
  obterArquivosModificadosBranch?: (branch: string) => Promise<string[]>;
  excluirBranchRemota?: (branch: string) => Promise<boolean>;
  criarPullRequestGithub?: (dados: {
    branch: string;
    titulo: string;
    descricao: string;
    nomeAutor: string;
    emailAutor: string;
  }) => Promise<{ numeroPr: number; urlPr: string }>;
  atualizarMetadadosPr?: (
    branch: string,
    dadosPr: { prNumber: number; prUrl: string },
  ) => Promise<boolean>;
  salvarMetadadosPr?: (
    branch: string,
    numeroPr: number,
    urlPr: string,
  ) => Promise<void>;
}

const CABECALHOS_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
};

export async function processarRequisicaoCreatePr(
  requisicao: Request,
  contexto?: ContextoCreatePr,
): Promise<Response> {
  if (requisicao.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CABECALHOS_CORS });
  }

  if (requisicao.method !== "POST") {
    return new Response("Método não suportado.", {
      status: 405,
      headers: CABECALHOS_CORS,
    });
  }

  const cabecalhoAuth = requisicao.headers.get("Authorization");
  if (!cabecalhoAuth) {
    return new Response(
      JSON.stringify({ erro: "Não autorizado: token ausente." }),
      {
        status: 401,
        headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
      },
    );
  }

  const funcaoValidarJwt = contexto?.validarJwt || validarTokenJwt;
  const usuario = await funcaoValidarJwt(cabecalhoAuth);
  if (!usuario) {
    return new Response(
      JSON.stringify({ erro: "Não autorizado: token inválido ou expirado." }),
      {
        status: 401,
        headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
      },
    );
  }

  let corpoJson: any;
  try {
    corpoJson = await requisicao.json();
  } catch (_e) {
    return new Response(
      JSON.stringify({ erro: "Corpo da requisição inválido (JSON esperado)." }),
      {
        status: 400,
        headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
      },
    );
  }

  const { branch, title, description } = corpoJson || {};
  if (!branch || !title) {
    return new Response(
      JSON.stringify({
        erro: "Parâmetros obrigatórios ausentes: branch e title são necessários.",
      }),
      {
        status: 400,
        headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
      },
    );
  }

  const validacaoBranch = validarNomeBranch(branch);
  if (!validacaoBranch.valida || !validacaoBranch.nomeBranch) {
    return new Response(
      JSON.stringify({ erro: `Nome de branch inválido: ${validacaoBranch.motivo}` }),
      {
        status: 400,
        headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
      },
    );
  }

  const nomeSimplesBranch = validacaoBranch.nomeBranch;
  const funcaoObterArquivos = contexto?.obterArquivosModificadosBranch || obterArquivosModificadosBranch;
  const funcaoExcluirBranch = contexto?.excluirBranchRemota || excluirBranchRemota;

  let arquivosModificados: string[];
  try {
    arquivosModificados = await funcaoObterArquivos(nomeSimplesBranch);
  } catch (erro: any) {
    return new Response(
      JSON.stringify({ erro: `Falha ao inspecionar branch no GitHub: ${erro.message}` }),
      {
        status: 400,
        headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
      },
    );
  }

  const validacaoEscopo = validarEscopoArquivos(arquivosModificados);
  if (!validacaoEscopo.valido) {
    // Violação de segurança: deleta a branch remota imediatamente
    await funcaoExcluirBranch(nomeSimplesBranch);
    return new Response(
      JSON.stringify({
        erro: "Violação de segurança: apenas alterações dentro da pasta 'database/' são permitidas. A branch foi removida.",
        arquivos_invalidos: validacaoEscopo.arquivosForaDoEscopo,
      }),
      {
        status: 400,
        headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
      },
    );
  }

  const funcaoCriarPr = contexto?.criarPullRequestGithub || criarPullRequestGithub;
  const funcaoAtualizarMetadados =
    contexto?.atualizarMetadadosPr ||
    (async (b, d) => {
      if (contexto?.salvarMetadadosPr) {
        await contexto.salvarMetadadosPr(b, d.prNumber, d.prUrl);
        return true;
      }
      return await atualizarMetadadosPr(b, d);
    });

  const resultadoPr = await funcaoCriarPr({
    branch: nomeSimplesBranch,
    titulo: title,
    descricao: description || "",
    nomeAutor: usuario.nomeCompleto,
    emailAutor: usuario.email,
  });

  await funcaoAtualizarMetadados(nomeSimplesBranch, {
    prNumber: resultadoPr.numeroPr,
    prUrl: resultadoPr.urlPr,
  });

  return new Response(
    JSON.stringify({
      numero_pr: resultadoPr.numeroPr,
      url_pr: resultadoPr.urlPr,
    }),
    {
      status: 200,
      headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
    },
  );
}

Deno.serve(async (req) => {
  return await processarRequisicaoCreatePr(req);
});
