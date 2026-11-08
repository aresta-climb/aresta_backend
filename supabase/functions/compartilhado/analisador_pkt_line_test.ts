// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "@std/assert";
import {
  criarLinhaPktLine,
  extrairComandosGit,
  extrairErrosResultadoReceivePack,
} from "./analisador_pkt_line.ts";

Deno.test("analisador_pkt_line: extrai comando de criacao de branch com sucesso", () => {
  const linhaComando =
    "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-123\0report-status\n";
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
  const linhaComando =
    "7c2d1e0000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-123\n";
  const pktLine = criarLinhaPktLine(linhaComando);

  const comandos = extrairComandosGit(pktLine);
  assertEquals(comandos.length, 1);
  assertEquals(comandos[0].ehCriacao, false);
  assertEquals(comandos[0].ehExclusao, false);
  assertEquals(comandos[0].ehAtualizacao, true);
});

Deno.test("analisador_pkt_line: extrai comando de exclusao de branch", () => {
  const linhaComando =
    "7c2d1e0000000000000000000000000000000000 0000000000000000000000000000000000000000 refs/heads/sugestao-lapinha-123\n";
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

Deno.test("analisador_pkt_line: extrairErrosResultadoReceivePack detecta sucesso e erros diretos e em side-band-64k", () => {
  const pktUnpackOk = criarLinhaPktLine("unpack ok\n");
  const pktRefOk = criarLinhaPktLine("ok refs/heads/edicao-lapinha-123\n");
  const flush = new TextEncoder().encode("0000");

  // 1. Sucesso direto sem erros
  const bufferSucesso = new Uint8Array([...pktUnpackOk, ...pktRefOk, ...flush]);
  assertEquals(extrairErrosResultadoReceivePack(bufferSucesso), []);

  // 2. Erro direto (unpack falhou + ng na ref)
  const pktUnpackErro = criarLinhaPktLine("unpack index-pack failed\n");
  const pktRefNg = criarLinhaPktLine("ng refs/heads/edicao-lapinha-123 missing necessary objects\n");
  const bufferErroDireto = new Uint8Array([...pktUnpackErro, ...pktRefNg, ...flush]);
  assertEquals(extrairErrosResultadoReceivePack(bufferErroDireto), [
    "unpack index-pack failed",
    "ng refs/heads/edicao-lapinha-123 missing necessary objects",
  ]);

  // 3. Encapsulado em side-band-64k (canal 2 de progresso + canal 1 com report-status contendo ng + canal 3 erro fatal)
  const pacoteProgresso = criarLinhaPktLine("\x02Resolving deltas: 100%\n");
  const reportStatusInterno = new TextDecoder().decode(
    new Uint8Array([...pktUnpackOk, ...pktRefNg, ...flush]),
  );
  const pacoteSideband1 = criarLinhaPktLine(`\x01${reportStatusInterno}`);
  const pacoteSideband3 = criarLinhaPktLine("\x03erro fatal do servidor\n");
  const bufferSideband = new Uint8Array([
    ...pacoteProgresso,
    ...pacoteSideband1,
    ...pacoteSideband3,
    ...flush,
  ]);

  assertEquals(extrairErrosResultadoReceivePack(bufferSideband), [
    "ng refs/heads/edicao-lapinha-123 missing necessary objects",
    "erro fatal do servidor",
  ]);
});
