// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

/**
 * Biblioteca para validação automatizada de cabeçalhos SPDX (MPL-2.0) e integridade
 * estrutural das migrações SQL do repositório `aresta_backend`.
 */

const PASTAS_IGNORADAS = new Set([
  ".git",
  "node_modules",
  "aresta_api",
  "cov_profile",
  "cov_sentry_real",
  ".wrangler",
  "dist",
  "build",
]);

const EXTENSOES_VALIDADAS = new Set([
  ".ts",
  ".mjs",
  ".js",
  ".sql",
  ".yml",
  ".yaml",
]);

const PADRAO_NOME_MIGRACAO_SQL = /^\d{14}_[a-z0-9_]+\.sql$/;

/**
 * Retorna o prefixo de comentário de linha correspondente à extensão do arquivo.
 */
export function obterPrefixoComentario(extensao: string): string {
  if (extensao === ".sql") {
    return "--";
  }
  if (extensao === ".yml" || extensao === ".yaml") {
    return "#";
  }
  return "//";
}

/**
 * Verifica se o conteúdo de um arquivo contém o cabeçalho SPDX MPL-2.0 e Copyright
 * válido (ano >= 2026 com titular Aresta Contributors / Aresta Climb Contributors)
 * nas primeiras 5 linhas.
 */
export function possuiCabecalhoSpdxValido(
  conteudo: string,
  extensao: string,
): boolean {
  const prefixo = obterPrefixoComentario(extensao);
  const linhasIniciais = conteudo
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(0, 5)
    .map((linha) => linha.trim());

  const regexLicenca = new RegExp(
    `^${prefixo}\\s*SPDX-License-Identifier:\\s*MPL-2\\.0$`,
  );
  const regexCopyright = new RegExp(
    `^${prefixo}\\s*(?:SPDX-FileCopyrightText:\\s*)?Copyright\\s*\\([Cc]\\)\\s*(\\d{4})(?:-\\d{4})?\\s+Aresta\\s+(?:Climb\\s+)?Contributors$`,
  );

  const temLicenca = linhasIniciais.some((linha) => regexLicenca.test(linha));
  const linhaCopyright = linhasIniciais.find((linha) =>
    regexCopyright.test(linha)
  );

  if (!temLicenca || !linhaCopyright) {
    return false;
  }

  const matchAno = regexCopyright.exec(linhaCopyright);
  const anoInicial = Number(matchAno![1]);
  return anoInicial >= 2026;
}

/**
 * Determina se um caminho relativo deve ser ignorado durante a varredura de conformidade SPDX
 * (ex: submódulos, dependências externas, relatórios de cobertura ou tipos gerados pelo Wrangler).
 */
export function deveIgnorarCaminhoSpdx(caminhoRelativo: string): boolean {
  const normalizado = caminhoRelativo.replaceAll("\\", "/");
  const partes = normalizado.split("/").filter((parte) => parte.length > 0);

  if (partes.some((parte) => PASTAS_IGNORADAS.has(parte))) {
    return true;
  }

  return normalizado.endsWith("worker-configuration.d.ts");
}

function extrairExtensao(nomeArquivo: string): string {
  const indicePonto = nomeArquivo.lastIndexOf(".");
  return indicePonto >= 0 ? nomeArquivo.slice(indicePonto).toLowerCase() : "";
}

async function coletarArquivosElegiveis(
  diretorioBase: string,
  prefixoRelativo = "",
): Promise<Array<{ caminhoAbsoluto: string; caminhoRelativo: string; extensao: string }>> {
  const encontrados: Array<{
    caminhoAbsoluto: string;
    caminhoRelativo: string;
    extensao: string;
  }> = [];

  for await (const entrada of Deno.readDir(diretorioBase)) {
    const caminhoRelativo = prefixoRelativo
      ? `${prefixoRelativo}/${entrada.name}`
      : entrada.name;

    if (deveIgnorarCaminhoSpdx(caminhoRelativo)) {
      continue;
    }

    const caminhoAbsoluto = `${diretorioBase}/${entrada.name}`;

    if (entrada.isDirectory) {
      const subArquivos = await coletarArquivosElegiveis(
        caminhoAbsoluto,
        caminhoRelativo,
      );
      encontrados.push(...subArquivos);
      continue;
    }

    const extensao = extrairExtensao(entrada.name);
    if (EXTENSOES_VALIDADAS.has(extensao)) {
      encontrados.push({ caminhoAbsoluto, caminhoRelativo, extensao });
    }
  }

  return encontrados;
}

/**
 * Varre recursivamente um diretório raiz e retorna a lista de arquivos elegíveis
 * que não possuem o cabeçalho SPDX MPL-2.0 obrigatório.
 */
export async function validarCabecalhosSpdxRepositorio(
  diretorioRaiz: string,
): Promise<string[]> {
  const arquivos = await coletarArquivosElegiveis(diretorioRaiz);

  if (arquivos.length === 0) {
    return ["Nenhum arquivo elegível encontrado para validação SPDX."];
  }

  const naoConformes: string[] = [];

  for (const arquivo of arquivos) {
    const conteudo = await Deno.readTextFile(arquivo.caminhoAbsoluto);
    if (!possuiCabecalhoSpdxValido(conteudo, arquivo.extensao)) {
      naoConformes.push(arquivo.caminhoRelativo);
    }
  }

  return naoConformes.sort();
}

/**
 * Valida todas as migrações SQL de um diretório quanto à nomenclatura cronológica,
 * presença do cabeçalho SPDX MPL-2.0 e existência de instruções SQL não vazias.
 */
export async function validarMigracoesSql(
  diretorioMigracoes: string,
): Promise<string[]> {
  const nomesSql: string[] = [];

  for await (const entrada of Deno.readDir(diretorioMigracoes)) {
    if (entrada.isFile && entrada.name.endsWith(".sql")) {
      nomesSql.push(entrada.name);
    }
  }

  nomesSql.sort();

  if (nomesSql.length === 0) {
    return ["Nenhuma migração SQL encontrada."];
  }

  const erros: string[] = [];

  for (const nome of nomesSql) {
    if (!PADRAO_NOME_MIGRACAO_SQL.test(nome)) {
      erros.push(
        `${nome}: nome de migração fora do padrão <YYYYMMDDHHMMSS>_<descricao>.sql`,
      );
    }

    const conteudo = await Deno.readTextFile(`${diretorioMigracoes}/${nome}`);
    if (!possuiCabecalhoSpdxValido(conteudo, ".sql")) {
      erros.push(`${nome}: cabeçalho SPDX MPL-2.0 ausente ou inválido`);
    }

    const instrucoesSemComentarios = conteudo
      .split(/\r?\n/)
      .filter((linha) => !linha.trim().startsWith("--"))
      .join("\n")
      .trim();

    if (instrucoesSemComentarios.length === 0) {
      erros.push(`${nome}: arquivo de migração sem instruções SQL`);
    }
  }

  return erros;
}
