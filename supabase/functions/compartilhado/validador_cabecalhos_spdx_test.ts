// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  deveIgnorarCaminhoSpdx,
  obterPrefixoComentario,
  possuiCabecalhoSpdxValido,
  validarCabecalhosSpdxRepositorio,
  validarMigracoesSql,
} from "./validador_cabecalhos_spdx.ts";

const RAIZ_REPOSITORIO = new URL("../../../", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
).replace(/\/+$/, "");

Deno.test("validador_cabecalhos_spdx: obterPrefixoComentario retorna prefixo correto para TS, SQL e YAML", () => {
  assertEquals(obterPrefixoComentario(".ts"), "//");
  assertEquals(obterPrefixoComentario(".mjs"), "//");
  assertEquals(obterPrefixoComentario(".sql"), "--");
  assertEquals(obterPrefixoComentario(".yml"), "#");
  assertEquals(obterPrefixoComentario(".yaml"), "#");
});

Deno.test("validador_cabecalhos_spdx: possuiCabecalhoSpdxValido aceita formatos oficiais em TS, MJS com shebang, SQL e YAML", () => {
  const tsComFileCopyright = [
    "// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors",
    "// SPDX-License-Identifier: MPL-2.0",
    "export const x = 1;",
  ].join("\n");
  assertEquals(possuiCabecalhoSpdxValido(tsComFileCopyright, ".ts"), true);

  const tsOrdemInvertidaEIntervalo = [
    "// SPDX-License-Identifier: MPL-2.0",
    "// Copyright (C) 2026-2028 Aresta Contributors",
    "export const y = 2;",
  ].join("\r\n");
  assertEquals(possuiCabecalhoSpdxValido(tsOrdemInvertidaEIntervalo, ".ts"), true);

  const mjsComShebang = [
    "#!/usr/bin/env node",
    "// SPDX-License-Identifier: MPL-2.0",
    "// Copyright (C) 2026 Aresta Contributors",
    "console.log('ok');",
  ].join("\n");
  assertEquals(possuiCabecalhoSpdxValido(mjsComShebang, ".mjs"), true);

  const sqlValido = [
    "-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors",
    "-- SPDX-License-Identifier: MPL-2.0",
    "SELECT 1;",
  ].join("\n");
  assertEquals(possuiCabecalhoSpdxValido(sqlValido, ".sql"), true);

  const yamlValido = [
    "# SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors",
    "# SPDX-License-Identifier: MPL-2.0",
    "name: CI",
  ].join("\n");
  assertEquals(possuiCabecalhoSpdxValido(yamlValido, ".yml"), true);
});

Deno.test("validador_cabecalhos_spdx: possuiCabecalhoSpdxValido rejeita arquivos sem licenca, sem copyright ou com ano anterior a 2026", () => {
  const semLicenca = "// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors\nexport {};";
  assertEquals(possuiCabecalhoSpdxValido(semLicenca, ".ts"), false);

  const semCopyright = "// SPDX-License-Identifier: MPL-2.0\nexport {};";
  assertEquals(possuiCabecalhoSpdxValido(semCopyright, ".ts"), false);

  const anoInvalido = [
    "// SPDX-FileCopyrightText: Copyright (C) 2024 Aresta Climb Contributors",
    "// SPDX-License-Identifier: MPL-2.0",
  ].join("\n");
  assertEquals(possuiCabecalhoSpdxValido(anoInvalido, ".ts"), false);

  const outraLicenca = [
    "// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors",
    "// SPDX-License-Identifier: MIT",
  ].join("\n");
  assertEquals(possuiCabecalhoSpdxValido(outraLicenca, ".ts"), false);
});

Deno.test("validador_cabecalhos_spdx: deveIgnorarCaminhoSpdx ignora pastas de terceiros, submodulos e d.ts gerados pelo Wrangler", () => {
  assertEquals(deveIgnorarCaminhoSpdx("aresta_api/src/index.ts"), true);
  assertEquals(deveIgnorarCaminhoSpdx("cloudflare\\alertas\\node_modules\\pkg\\index.js"), true);
  assertEquals(deveIgnorarCaminhoSpdx("cloudflare/feedback/worker-configuration.d.ts"), true);
  assertEquals(deveIgnorarCaminhoSpdx("cov_profile/dados.json"), true);
  assertEquals(deveIgnorarCaminhoSpdx("supabase/functions/git-proxy/index.ts"), false);
  assertEquals(deveIgnorarCaminhoSpdx("cloudflare/alertas/src/index.ts"), false);
});

Deno.test("validador_cabecalhos_spdx: validarCabecalhosSpdxRepositorio detecta arquivos sem SPDX e aprova diretorio conforme", async () => {
  const dirTemp = await Deno.makeTempDir({ prefix: "teste_spdx_" });
  try {
    const erroVazio = await validarCabecalhosSpdxRepositorio(dirTemp);
    assertEquals(erroVazio, ["Nenhum arquivo elegível encontrado para validação SPDX."]);

    await Deno.mkdir(`${dirTemp}/src`, { recursive: true });
    await Deno.mkdir(`${dirTemp}/node_modules/pacote`, { recursive: true });
    await Deno.writeTextFile(`${dirTemp}/LICENSE`, "MPL-2.0");
    await Deno.writeTextFile(`${dirTemp}/node_modules/pacote/index.js`, "console.log(1);");

    await Deno.writeTextFile(
      `${dirTemp}/src/valido.ts`,
      "// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors\n// SPDX-License-Identifier: MPL-2.0\nexport const ok = true;\n",
    );
    await Deno.writeTextFile(
      `${dirTemp}/src/invalido.ts`,
      "export const semCabecalho = true;\n",
    );

    const naoConformes = await validarCabecalhosSpdxRepositorio(dirTemp);
    assertEquals(naoConformes, ["src/invalido.ts"]);

    await Deno.writeTextFile(
      `${dirTemp}/src/invalido.ts`,
      "// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors\n// SPDX-License-Identifier: MPL-2.0\nexport const comCabecalho = true;\n",
    );
    const aposCorrecao = await validarCabecalhosSpdxRepositorio(dirTemp);
    assertEquals(aposCorrecao, []);
  } finally {
    await Deno.remove(dirTemp, { recursive: true });
  }
});

Deno.test("validador_cabecalhos_spdx: validarMigracoesSql valida padrao de nome, cabecalho SPDX e corpo SQL", async () => {
  const dirTemp = await Deno.makeTempDir({ prefix: "teste_migracoes_" });
  try {
    const erroSemSql = await validarMigracoesSql(dirTemp);
    assertEquals(erroSemSql, ["Nenhuma migração SQL encontrada."]);

    await Deno.writeTextFile(`${dirTemp}/README.md`, "# Ignorado");
    await Deno.writeTextFile(
      `${dirTemp}/nome_invalido.sql`,
      "SELECT 1;\n",
    );
    await Deno.writeTextFile(
      `${dirTemp}/20261025000000_vazia.sql`,
      "-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors\n-- SPDX-License-Identifier: MPL-2.0\n-- apenas comentario\n",
    );
    await Deno.writeTextFile(
      `${dirTemp}/20261025010000_valida.sql`,
      "-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors\n-- SPDX-License-Identifier: MPL-2.0\nCREATE TABLE teste (id INT);\n",
    );

    const erros = await validarMigracoesSql(dirTemp);
    assertEquals(erros, [
      "20261025000000_vazia.sql: arquivo de migração sem instruções SQL",
      "nome_invalido.sql: nome de migração fora do padrão <YYYYMMDDHHMMSS>_<descricao>.sql",
      "nome_invalido.sql: cabeçalho SPDX MPL-2.0 ausente ou inválido",
    ]);
  } finally {
    await Deno.remove(dirTemp, { recursive: true });
  }
});

Deno.test("validador_cabecalhos_spdx: escopo migracoes SQL em supabase/migrations possui nome valido, cabecalho SPDX MPL-2.0 e instrucoes SQL", async () => {
  const errosMigracoes = await validarMigracoesSql(
    `${RAIZ_REPOSITORIO}/supabase/migrations`,
  );
  assertEquals(
    errosMigracoes,
    [],
    `Erros encontrados nas migrações SQL:\n${errosMigracoes.join("\n")}`,
  );
});

Deno.test("validador_cabecalhos_spdx: escopo compartilhado em supabase/functions/compartilhado possui cabecalho SPDX MPL-2.0", async () => {
  const semSpdx = await validarCabecalhosSpdxRepositorio(
    `${RAIZ_REPOSITORIO}/supabase/functions/compartilhado`,
  );
  assertEquals(semSpdx, []);
});

for (const nomeFuncao of ["app-feedback", "git-proxy", "create-pr"]) {
  Deno.test(`validador_cabecalhos_spdx: escopo function ${nomeFuncao} possui cabecalho SPDX MPL-2.0`, async () => {
    const semSpdx = await validarCabecalhosSpdxRepositorio(
      `${RAIZ_REPOSITORIO}/supabase/functions/${nomeFuncao}`,
    );
    assertEquals(semSpdx, []);
  });
}

for (const nomeWorker of ["alertas", "app-links", "catalogo", "feedback", "previa"]) {
  Deno.test(`validador_cabecalhos_spdx: escopo worker ${nomeWorker} possui cabecalho SPDX MPL-2.0`, async () => {
    const semSpdx = await validarCabecalhosSpdxRepositorio(
      `${RAIZ_REPOSITORIO}/cloudflare/${nomeWorker}`,
    );
    assertEquals(semSpdx, []);
  });
}

Deno.test("validador_cabecalhos_spdx: todos os arquivos de codigo, migracoes SQL e workflows do repositorio possuem cabecalho SPDX MPL-2.0", async () => {
  const arquivosSemSpdx = await validarCabecalhosSpdxRepositorio(RAIZ_REPOSITORIO);
  assertEquals(
    arquivosSemSpdx,
    [],
    `Os seguintes arquivos do repositório não possuem cabeçalho SPDX MPL-2.0 válido:\n${arquivosSemSpdx.join("\n")}`,
  );
});

Deno.test("validador_cabecalhos_spdx: workflow deploy-functions.yml testa migracoes, functions e workers com fail-fast desativado antes do deploy", async () => {
  const conteudoWorkflow = await Deno.readTextFile(
    `${RAIZ_REPOSITORIO}/.github/workflows/deploy-functions.yml`,
  );

  // Não deve restringir o gatilho push por paths para garantir execução a cada commit
  assert(
    !conteudoWorkflow.includes("paths:"),
    "O workflow não deve restringir paths no push para garantir que todos os testes rodem a cada commit.",
  );

  // Deve testar migrações antes de supabase db push
  const idxTesteMigracao = conteudoWorkflow.indexOf("escopo migracoes SQL");
  const idxDbPush = conteudoWorkflow.indexOf("supabase db push");
  assert(idxTesteMigracao > 0 && idxDbPush > idxTesteMigracao);

  // Deve manter deploy independente de falha em migrate-database e fail-fast: false
  assertStringIncludes(conteudoWorkflow, "if: always() && !cancelled()");
  assertStringIncludes(conteudoWorkflow, "fail-fast: false");

  // Deve testar cada Edge Function antes do supabase functions deploy
  const idxTesteFunction = conteudoWorkflow.indexOf("escopo function ${{ matrix.function }}");
  const idxDeployFunction = conteudoWorkflow.indexOf("supabase functions deploy ${{ matrix.function }}");
  assert(idxTesteFunction > 0 && idxDeployFunction > idxTesteFunction);

  // Deve testar todos os 5 Cloudflare Workers
  for (const worker of ["alertas", "app-links", "catalogo", "feedback", "previa"]) {
    assertStringIncludes(conteudoWorkflow, `- ${worker}`);
  }
  assertStringIncludes(conteudoWorkflow, 'cloudflare/${{ matrix.worker }}/test/');
});
