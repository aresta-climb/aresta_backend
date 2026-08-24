// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "@std/assert";
import { extrairComandosGit, criarLinhaPktLine } from "./analisador_pkt_line.ts";

Deno.test("analisador_pkt_line: extrai comando de criacao de branch com sucesso", () => {
  const linhaComando = "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-123\0report-status\n";
  const pktLine = criarLinhaPktLine(linhaComando);
  const buffer = new Uint8Array([...pktLine, 0x30, 0x30, 0x30, 0x30]); // Adiciona 0000 flush

  const comandos = extrairComandosGit(buffer);
  assertEquals(comandos.length, 1);
  assertEquals(comandos[0].idAntigo, "0000000000000000000000000000000000000000");
  assertEquals(comandos[0].idNovo, "8a3f5b0000000000000000000000000000000000");
  assertEquals(comandos[0].nomeReferencia, "refs/heads/sugestao-lapinha-123");
  assertEquals(comandos[0].ehCriacao, true);
  assertEquals(comandos[0].ehExclusao, false);
  assertEquals(comandos[0].ehAtualizacao, false);
});

Deno.test("analisador_pkt_line: extrai comando de atualizacao de branch", () => {
  const linhaComando = "7c2d1e0000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-123\n";
  const pktLine = criarLinhaPktLine(linhaComando);

  const comandos = extrairComandosGit(pktLine);
  assertEquals(comandos.length, 1);
  assertEquals(comandos[0].ehCriacao, false);
  assertEquals(comandos[0].ehExclusao, false);
  assertEquals(comandos[0].ehAtualizacao, true);
});

Deno.test("analisador_pkt_line: extrai comando de exclusao de branch", () => {
  const linhaComando = "7c2d1e0000000000000000000000000000000000 0000000000000000000000000000000000000000 refs/heads/sugestao-lapinha-123\n";
  const pktLine = criarLinhaPktLine(linhaComando);

  const comandos = extrairComandosGit(pktLine);
  assertEquals(comandos.length, 1);
  assertEquals(comandos[0].ehCriacao, false);
  assertEquals(comandos[0].ehExclusao, true);
  assertEquals(comandos[0].ehAtualizacao, false);
});

Deno.test("analisador_pkt_line: retorna vazio para buffer vazio ou apenas flush", () => {
  const flush = new TextEncoder().encode("0000");
  const comandos = extrairComandosGit(flush);
  assertEquals(comandos.length, 0);

  const vazio = new Uint8Array([]);
  assertEquals(extrairComandosGit(vazio).length, 0);
});
