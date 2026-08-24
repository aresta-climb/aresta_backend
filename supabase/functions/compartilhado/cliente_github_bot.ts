// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { Octokit } from "octokit";

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
    const octokit = new Octokit({
      auth: {
        appId: idAppOuClient,
        privateKey: privateKey.replace(/\\n/g, "\n"),
        installationId: parseInt(installationId, 10),
      },
    });
    const autenticacao = (await octokit.auth({ type: "installation" })) as any;
    return autenticacao.token;
  }

  return "";
}

export function obterInstanciaOctokit(tokenBot?: string): Octokit {
  const token = tokenBot || Deno.env.get("GITHUB_BOT_TOKEN") || "";
  return new Octokit({ auth: token });
}

export async function verificarBranchExisteNoGithub(
  nomeBranch: string,
  octokitPersonalizado?: any,
  dono = DONO_REPOSITORIO_PADRAO,
  repositorio = NOME_REPOSITORIO_PADRAO,
): Promise<boolean> {
  const octokit = octokitPersonalizado || obterInstanciaOctokit();
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
    throw erro;
  }
}

export async function obterArquivosModificadosBranch(
  nomeBranch: string,
  branchBase = "main",
  octokitPersonalizado?: any,
  dono = DONO_REPOSITORIO_PADRAO,
  repositorio = NOME_REPOSITORIO_PADRAO,
): Promise<string[]> {
  const octokit = octokitPersonalizado || obterInstanciaOctokit();
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
  const octokit = octokitPersonalizado || obterInstanciaOctokit();
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
): Promise<{ numeroPr: number; urlPr: string }> {
  const octokit = octokitPersonalizado || obterInstanciaOctokit();
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

  const resposta = await octokit.rest.pulls.create({
    owner: dono,
    repo: repositorio,
    title: dados.titulo,
    head: branchLimpa,
    base: "main",
    body: corpoFormatado,
  });

  return {
    numeroPr: resposta.data.number,
    urlPr: resposta.data.html_url,
  };
}
