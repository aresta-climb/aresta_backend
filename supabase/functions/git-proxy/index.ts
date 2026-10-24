// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import {
  ROTA_GIT_PROXY_BASE,
  ROTA_GIT_PROXY_INFO_REFS,
  ROTA_GIT_PROXY_RECEIVE_PACK,
} from "../../../aresta_api/openapi/generated/ts/colaboracao.ts";
import { extrairComandosGit } from "../compartilhado/analisador_pkt_line.ts";
import { validarNomeBranch, extrairNomeSimplesBranch } from "../compartilhado/validador_regras_branch.ts";
import {
  validarTokenJwt,
  obterRegistroBranch,
  registrarNovaBranch,
  DadosUsuarioAutenticado,
  RegistroBranchSugestao,
} from "../compartilhado/cliente_supabase_controle.ts";
import {
  verificarBranchExisteNoGithub,
  obterTokenAutenticacaoGithub,
} from "../compartilhado/cliente_github_bot.ts";
import {
  InterfaceRelatorSentry,
  relatarErroSentry,
} from "../compartilhado/relator_sentry.ts";

const URL_REPOSITORIO_GITHUB = "https://github.com/aresta-climb/aresta_db.git";
const SUFIXO_INFO_REFS = ROTA_GIT_PROXY_INFO_REFS.slice(ROTA_GIT_PROXY_BASE.length);
const SUFIXO_RECEIVE_PACK = ROTA_GIT_PROXY_RECEIVE_PACK.slice(ROTA_GIT_PROXY_BASE.length);

export interface ContextoGitProxy {
  validarJwt?: (token: string) => Promise<DadosUsuarioAutenticado | null>;
  verificarBranchExisteNoGithub?: (branch: string) => Promise<boolean>;
  obterRegistroBranch?: (branch: string) => Promise<RegistroBranchSugestao | null>;
  obterAutorOriginalBranch?: (branch: string) => Promise<{ emailAutor: string; nomeAutor: string } | null>;
  registrarNovaBranch?: (dados: {
    branchName: string;
    authorId: string | null;
    authorEmail: string;
    authorName: string;
  }) => Promise<RegistroBranchSugestao | null>;
  executarFetchGithub?: (url: string, init?: RequestInit) => Promise<Response>;
  tokenBot?: string;
  sentryDsn?: string;
  relatorSentry?: InterfaceRelatorSentry;
}

const CABECALHOS_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
};

export async function processarRequisicaoGitProxy(
  requisicao: Request,
  contexto?: ContextoGitProxy,
): Promise<Response> {
  try {
    return await executarFluxoGitProxy(requisicao, contexto);
  } catch (erro: any) {
    console.error("Erro interno no git-proxy:", erro);
    await relatarErroSentry(
      erro,
      {
        dsn: contexto?.sentryDsn ?? Deno.env.get("SENTRY_DSN"),
        servico: "supabase-git-proxy",
        requisicao,
      },
      contexto?.relatorSentry,
    );
    return new Response(
      `Erro interno no git-proxy: ${erro?.message || erro}`,
      {
        status: 500,
        headers: CABECALHOS_CORS,
      },
    );
  }
}

async function executarFluxoGitProxy(
  requisicao: Request,
  contexto?: ContextoGitProxy,
): Promise<Response> {
  if (requisicao.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CABECALHOS_CORS });
  }

  const cabecalhoAuth = requisicao.headers.get("Authorization");
  if (!cabecalhoAuth) {
    return new Response("Não autorizado: token ausente.", {
      status: 401,
      headers: {
        ...CABECALHOS_CORS,
        "WWW-Authenticate": 'Basic realm="git-proxy"',
      },
    });
  }

  const funcaoValidarJwt = contexto?.validarJwt || validarTokenJwt;
  const usuario = await funcaoValidarJwt(cabecalhoAuth);
  if (!usuario) {
    return new Response("Não autorizado: token inválido ou expirado.", {
      status: 401,
      headers: {
        ...CABECALHOS_CORS,
        "WWW-Authenticate": 'Basic realm="git-proxy"',
      },
    });
  }

  const urlRequisicao = new URL(requisicao.url);
  const tokenBot = contexto?.tokenBot || (await obterTokenAutenticacaoGithub());
  const credencialGithub = `Basic ${btoa(`x-access-token:${tokenBot}`)}`;
  const funcaoFetchGithub = contexto?.executarFetchGithub || fetch;

  // 1. Rota GET /info/refs?service=git-receive-pack
  if (requisicao.method === "GET") {
    const urlGithub = `${URL_REPOSITORIO_GITHUB}${SUFIXO_INFO_REFS}${urlRequisicao.search}`;
    const respostaGithub = await funcaoFetchGithub(urlGithub, {
      method: "GET",
      headers: {
        "Authorization": credencialGithub,
        "Accept": "*/*",
      },
    });

    const cabecalhosResposta = new Headers(respostaGithub.headers);
    Object.entries(CABECALHOS_CORS).forEach(([c, v]) => cabecalhosResposta.set(c, v));

    return new Response(respostaGithub.body, {
      status: respostaGithub.status,
      headers: cabecalhosResposta,
    });
  }

  // 2. Rota POST /git-receive-pack
  if (requisicao.method === "POST") {
    const corpoArrayBuffer = await requisicao.arrayBuffer();
    const bufferCompleto = new Uint8Array(corpoArrayBuffer);

    const comandos = extrairComandosGit(bufferCompleto);
    if (comandos.length === 0) {
      return new Response("Requisição inválida: nenhum comando Git detectado.", {
        status: 400,
        headers: CABECALHOS_CORS,
      });
    }

    const funcaoVerificarExiste = contexto?.verificarBranchExisteNoGithub || verificarBranchExisteNoGithub;
    const funcaoObterRegistro = contexto?.obterRegistroBranch || obterRegistroBranch;
    const funcaoRegistrarNova = contexto?.registrarNovaBranch || registrarNovaBranch;

    for (const cmd of comandos) {
      const validacao = validarNomeBranch(cmd.nomeReferencia);
      if (!validacao.valida || !validacao.nomeBranch) {
        return new Response(`Acesso negado: ${validacao.motivo}`, {
          status: 403,
          headers: CABECALHOS_CORS,
        });
      }

      const nomeSimplesBranch = validacao.nomeBranch;

      if (cmd.ehCriacao) {
        const jaExisteNoGithub = await funcaoVerificarExiste(nomeSimplesBranch);
        const jaExisteNoBanco = await funcaoObterRegistro(nomeSimplesBranch);

        if (jaExisteNoGithub || jaExisteNoBanco) {
          return new Response("Conflito: a branch de sugestão já existe.", {
            status: 409,
            headers: CABECALHOS_CORS,
          });
        }

        await funcaoRegistrarNova({
          branchName: nomeSimplesBranch,
          authorId: usuario.idUsuario,
          authorEmail: usuario.email,
          authorName: usuario.nomeCompleto,
        });
      } else {
        // Atualização de branch existente
        const registro = await funcaoObterRegistro(nomeSimplesBranch);
        if (contexto?.obterAutorOriginalBranch) {
          const autorMock = await contexto.obterAutorOriginalBranch(nomeSimplesBranch);
          if (autorMock && autorMock.emailAutor !== usuario.email) {
            return new Response("Acesso negado: esta sugestão pertence a outro autor.", {
              status: 403,
              headers: CABECALHOS_CORS,
            });
          }
        } else if (registro && registro.author_email !== usuario.email) {
          return new Response("Acesso negado: esta sugestão pertence a outro autor.", {
            status: 403,
            headers: CABECALHOS_CORS,
          });
        }
      }
    }

    // Encaminha o tráfego via streaming para o GitHub com credenciais do Bot
    const urlGithub = `${URL_REPOSITORIO_GITHUB}${SUFIXO_RECEIVE_PACK}`;
    const respostaGithub = await funcaoFetchGithub(urlGithub, {
      method: "POST",
      headers: {
        "Authorization": credencialGithub,
        "Content-Type": "application/x-git-receive-pack-request",
        "Accept": "application/x-git-receive-pack-result",
      },
      body: bufferCompleto,
    });

    const cabecalhosResposta = new Headers(respostaGithub.headers);
    Object.entries(CABECALHOS_CORS).forEach(([c, v]) => cabecalhosResposta.set(c, v));

    return new Response(respostaGithub.body, {
      status: respostaGithub.status,
      headers: cabecalhosResposta,
    });
  }

  return new Response("Método não suportado.", { status: 405, headers: CABECALHOS_CORS });
}

if (import.meta.main) {
  Deno.serve((req) => processarRequisicaoGitProxy(req));
}
