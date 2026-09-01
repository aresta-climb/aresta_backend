// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { validarNomeBranch } from "../compartilhado/validador_regras_branch.ts";
import { validarEscopoArquivos } from "../compartilhado/validador_escopo_arquivos.ts";
import {
  validarTokenJwt,
  atualizarMetadadosPr,
  obterRegistroBranch,
  DadosUsuarioAutenticado,
  RegistroBranchSugestao,
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
  obterRegistroBranch?: (branch: string) => Promise<RegistroBranchSugestao | null>;
  criarPullRequestGithub?: (
    dados: {
      branch: string;
      titulo: string;
      descricao: string;
      nomeAutor: string;
      emailAutor: string;
    },
    octokitPersonalizado?: any,
    dono?: string,
    repositorio?: string,
    tokenUsuarioGithub?: string,
  ) => Promise<{ numeroPr: number; urlPr: string }>;
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
        headers: {
          ...CABECALHOS_CORS,
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="create-pr"',
        },
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
        headers: {
          ...CABECALHOS_CORS,
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="create-pr"',
        },
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

  const { branch, title, description, token_usuario_github, github_user_token } = corpoJson || {};
  const tokenUsuarioFinal = token_usuario_github || github_user_token;

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

  const funcaoObterRegistro =
    contexto?.obterRegistroBranch ||
    (async (b: string) => {
      try {
        return await obterRegistroBranch(b);
      } catch {
        return null;
      }
    });
  const registroExistente = await funcaoObterRegistro(nomeSimplesBranch);

  if (registroExistente && registroExistente.pr_number && registroExistente.pr_url) {
    return new Response(
      JSON.stringify({
        numero_pr: registroExistente.pr_number,
        url_pr: registroExistente.pr_url,
        pr_number: registroExistente.pr_number,
        pr_url: registroExistente.pr_url,
        atualizado: true,
      }),
      {
        status: 200,
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

  const resultadoPr = await funcaoCriarPr(
    {
      branch: nomeSimplesBranch,
      titulo: title,
      descricao: description || "",
      nomeAutor: usuario.nomeCompleto,
      emailAutor: usuario.email,
    },
    undefined,
    undefined,
    undefined,
    tokenUsuarioFinal,
  );

  await funcaoAtualizarMetadados(nomeSimplesBranch, {
    prNumber: resultadoPr.numeroPr,
    prUrl: resultadoPr.urlPr,
  });

  return new Response(
    JSON.stringify({
      numero_pr: resultadoPr.numeroPr,
      url_pr: resultadoPr.urlPr,
      pr_number: resultadoPr.numeroPr,
      pr_url: resultadoPr.urlPr,
    }),
    {
      status: 200,
      headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
    },
  );
}

Deno.serve(async (req) => {
  try {
    return await processarRequisicaoCreatePr(req);
  } catch (erro: any) {
    console.error("Erro interno no create-pr:", erro);
    return new Response(
      JSON.stringify({ erro: `Erro interno no servidor: ${erro?.message || erro}` }),
      {
        status: 500,
        headers: {
          ...CABECALHOS_CORS,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
