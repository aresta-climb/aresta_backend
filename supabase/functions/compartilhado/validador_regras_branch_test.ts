// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "@std/assert";
import { validarNomeBranch, extrairNomeSimplesBranch } from "./validador_regras_branch.ts";

Deno.test("validador_regras_branch: aceita branches validas com prefixo refs/heads/edicao- e sugestao-", () => {
  const resEdicao = validarNomeBranch("refs/heads/edicao-lapinha-20260823");
  assertEquals(resEdicao.valida, true);
  assertEquals(resEdicao.nomeBranch, "edicao-lapinha-20260823");

  const resSugestao = validarNomeBranch("refs/heads/sugestao-lapinha-20260823");
  assertEquals(resSugestao.valida, true);
  assertEquals(resSugestao.nomeBranch, "sugestao-lapinha-20260823");
});

Deno.test("validador_regras_branch: aceita branches validas com caracteres alfanumericos, tracos e sublinhados", () => {
  const resultado = validarNomeBranch("refs/heads/edicao_serra_do_cipo_123-abc");
  assertEquals(resultado.valida, true);
  assertEquals(resultado.nomeBranch, "edicao_serra_do_cipo_123-abc");
});

Deno.test("validador_regras_branch: rejeita expressamente a branch main", () => {
  const resultado = validarNomeBranch("refs/heads/main");
  assertEquals(resultado.valida, false);
  assertEquals(resultado.motivo, "Push para a branch main não é permitido.");
});

Deno.test("validador_regras_branch: rejeita branches que nao comecam com sugestao-", () => {
  const resultado1 = validarNomeBranch("refs/heads/master");
  assertEquals(resultado1.valida, false);

  const resultado2 = validarNomeBranch("refs/heads/feature-nova");
  assertEquals(resultado2.valida, false);

  const resultado3 = validarNomeBranch("");
  assertEquals(resultado3.valida, false);
});

Deno.test("validador_regras_branch: extrairNomeSimplesBranch remove o prefixo refs/heads/", () => {
  assertEquals(extrairNomeSimplesBranch("refs/heads/sugestao-teste"), "sugestao-teste");
  assertEquals(extrairNomeSimplesBranch("sugestao-teste"), "sugestao-teste");
});
