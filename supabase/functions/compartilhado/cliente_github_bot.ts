// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { Octokit, App } from "octokit";

const DONO_REPOSITORIO_PADRAO = "aresta-climb";
const NOME_REPOSITORIO_PADRAO = "aresta_db";

export async function obterTokenAutenticacaoGithub(tokenBot?: string): Promise<string> {
  if (tokenBot) return tokenBot;
  const tokenEnv = Deno.env.get("GITHUB_BOT_TOKEN");
  if (tokenEnv) return tokenEnv;

  const idAppOuClient =
    Deno.env.get("EDITOR_ARESTA_GITHUB_APP_CLIENT_ID") ||
    Deno.env.get("GITHUB_CLIENT_ID") ||
    Deno.env.get("GITHUB_APP_ID");
  const privateKey =
    Deno.env.get("EDITOR_ARESTA_GITHUB_APP_PRIVATE_KEY") ||
    Deno.env.get("GITHUB_APP_PRIVATE_KEY");
  const installationId =
    Deno.env.get("EDITOR_ARESTA_GITHUB_APP_INSTALLATION_ID") ||
    Deno.env.get("GITHUB_APP_INSTALLATION_ID");

  if (idAppOuClient && privateKey && installationId) {
    try {
      const app = new App({
        appId: idAppOuClient,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      });
      const autenticacao = (await app.octokit.auth({
        type: "installation",
        installationId: parseInt(installationId, 10),
      })) as any;
      return autenticacao.token || "";
    } catch (erro: any) {
      console.error("Erro ao autenticar como GitHub App:", erro?.message || erro);
      return "";
    }
  }

  return "";
}

export async function obterInstanciaOctokit(tokenBot?: string): Promise<Octokit> {
  const token = await obterTokenAutenticacaoGithub(tokenBot);
  return new Octokit({ auth: token });
}

export async function verificarBranchExisteNoGithub(
  nomeBranch: string,
  octokitPersonalizado?: any,
  dono = DONO_REPOSITORIO_PADRAO,
  repositorio = NOME_REPOSITORIO_PADRAO,
): Promise<boolean> {
  const octokit = octokitPersonalizado || (await obterInstanciaOctokit());
  const branchLimpa = nomeBranch.replace(/^refs\/heads\//, "");

  try {
    const resposta = await octokit.rest.repos.getBranch({
      owner: dono,
      repo: repositorio,
      branch: branchLimpa,
    });
    return resposta.status === 200;
  } catch (erro: any) {
    if (erro.status === 404) {
      return false;
    }
    console.error("Aviso ao verificar branch no GitHub:", erro?.message || erro);
    return false;
  }
}

export async function obterArquivosModificadosBranch(
  nomeBranch: string,
  branchBase = "main",
  octokitPersonalizado?: any,
  dono = DONO_REPOSITORIO_PADRAO,
  repositorio = NOME_REPOSITORIO_PADRAO,
): Promise<string[]> {
  const octokit = octokitPersonalizado || (await obterInstanciaOctokit());
  const branchLimpa = nomeBranch.replace(/^refs\/heads\//, "");

  const resposta = await octokit.rest.repos.compareCommits({
    owner: dono,
    repo: repositorio,
    base: branchBase,
    head: branchLimpa,
  });

  const arquivos = resposta.data.files || [];
  return arquivos.map((arq: any) => arq.filename);
}

export async function excluirBranchRemota(
  nomeBranch: string,
  octokitPersonalizado?: any,
  dono = DONO_REPOSITORIO_PADRAO,
  repositorio = NOME_REPOSITORIO_PADRAO,
): Promise<boolean> {
  const octokit = octokitPersonalizado || (await obterInstanciaOctokit());
  const branchLimpa = nomeBranch.replace(/^refs\/heads\//, "");

  try {
    const resposta = await octokit.rest.git.deleteRef({
      owner: dono,
      repo: repositorio,
      ref: `heads/${branchLimpa}`,
    });
    return resposta.status === 204;
  } catch (_erro) {
    return false;
  }
}

export async function criarPullRequestGithub(
  dados: {
    branch: string;
    titulo: string;
    descricao: string;
    nomeAutor: string;
    emailAutor: string;
  },
  octokitPersonalizado?: any,
  dono = DONO_REPOSITORIO_PADRAO,
  repositorio = NOME_REPOSITORIO_PADRAO,
  tokenUsuarioGithub?: string,
  fabricaOctokit?: (token?: string) => any,
): Promise<{ numeroPr: number; urlPr: string }> {
  let octokit: any;
  if (octokitPersonalizado) {
    octokit = octokitPersonalizado;
  } else if (tokenUsuarioGithub) {
    try {
      octokit = fabricaOctokit ? fabricaOctokit(tokenUsuarioGithub) : new Octokit({ auth: tokenUsuarioGithub });
    } catch {
      octokit = fabricaOctokit ? fabricaOctokit() : await obterInstanciaOctokit();
    }
  } else {
    octokit = fabricaOctokit ? fabricaOctokit() : await obterInstanciaOctokit();
  }

  const branchLimpa = dados.branch.replace(/^refs\/heads\//, "");

  const corpoFormatado = [
    `> 🧗 **Sugestão de Croqui enviada via Aresta Editor**`,
    `> **Autor:** ${dados.nomeAutor} (\`${dados.emailAutor}\`)`,
    `> **Branch:** \`${branchLimpa}\``,
    ``,
    `---`,
    `### Descrição:`,
    dados.descricao.trim(),
    ``,
    `Signed-off-by: ${dados.nomeAutor} <${dados.emailAutor}>`,
  ].join("\n");

  const executarCriacao = async (cliente: any) => {
    return await cliente.rest.pulls.create({
      owner: dono,
      repo: repositorio,
      title: dados.titulo,
      head: branchLimpa,
      base: "main",
      body: corpoFormatado,
    });
  };

  try {
    const resposta = await executarCriacao(octokit);
    return {
      numeroPr: resposta.data.number,
      urlPr: resposta.data.html_url,
    };
  } catch (erro: any) {
    // Se foi usado token do usuário e falhou (401, 403, etc), tenta fallback para o Bot
    if (tokenUsuarioGithub && !octokitPersonalizado) {
      try {
        console.warn(`[AVISO] Tentativa com token de usuário falhou (${erro.message}). Realizando fallback para o Bot.`);
        const clienteBot = fabricaOctokit ? fabricaOctokit() : await obterInstanciaOctokit();
        const respostaBot = await executarCriacao(clienteBot);
        return {
          numeroPr: respostaBot.data.number,
          urlPr: respostaBot.data.html_url,
        };
      } catch (erroBot: any) {
        erro = erroBot;
      }
    }

    try {
      const clienteBusca = octokitPersonalizado || (fabricaOctokit ? fabricaOctokit() : await obterInstanciaOctokit());
      const pulls = await clienteBusca.rest.pulls.list({
        owner: dono,
        repo: repositorio,
        head: `${dono}:${branchLimpa}`,
        state: "all",
      });
      if (pulls.data && pulls.data.length > 0) {
        return {
          numeroPr: pulls.data[0].number,
          urlPr: pulls.data[0].html_url,
        };
      }
    } catch (_erroBusca) {
      // Ignora erro de busca e relança erro original
    }
    throw erro;
  }
}
