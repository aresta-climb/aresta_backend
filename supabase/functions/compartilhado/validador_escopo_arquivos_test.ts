// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "@std/assert";
import { validarEscopoArquivos } from "./validador_escopo_arquivos.ts";

Deno.test("validador_escopo_arquivos: aprova quando todos os arquivos estao em database/", () => {
  const arquivos = [
    "database/lapinha/croqui.yaml",
    "database/lapinha/setores/central.yaml",
    "database/lapinha/mapas/setor1.webp",
  ];

  const resultado = validarEscopoArquivos(arquivos);
  assertEquals(resultado.valido, true);
  assertEquals(resultado.arquivosForaDoEscopo.length, 0);
});

Deno.test("validador_escopo_arquivos: rejeita quando ha arquivos fora de database/", () => {
  const arquivos = [
    "database/lapinha/croqui.yaml",
    ".github/workflows/deploy.yml",
    "src/index.ts",
  ];

  const resultado = validarEscopoArquivos(arquivos);
  assertEquals(resultado.valido, false);
  assertEquals(resultado.arquivosForaDoEscopo, [
    ".github/workflows/deploy.yml",
    "src/index.ts",
  ]);
});

Deno.test("validador_escopo_arquivos: rejeita lista vazia de arquivos", () => {
  const resultado = validarEscopoArquivos([]);
  assertEquals(resultado.valido, false);
  assertEquals(resultado.arquivosForaDoEscopo.length, 0);
});
