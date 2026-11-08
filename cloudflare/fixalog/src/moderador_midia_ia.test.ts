// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { construirZipEpubEmMemoria } from "./extrator_indice_epub.ts";
import { construirMp4ComAtomosStssTeste } from "./extrator_iframes_mp4.ts";
import { AmbienteFixalogFake } from "./fakes/ambiente_fixalog_fake.ts";
import { executarModeracaoAssincronaLaudo } from "./moderador_midia_ia.ts";

Deno.test("moderador_midia_ia: aprova fotos e todos os I-Frames de vídeo MP4 legítimos e promove status para ativo", async () => {
  const env = new AmbienteFixalogFake();
  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_ok",
      1,
      "laudos/sessao_ok/v1.epub",
      500,
      "hash",
      "fp",
      "Renato",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      "2026-11-08T00:00:00Z",
    )
    .run();

  const mp4 = construirMp4ComAtomosStssTeste([1, 301, 601]);
  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midia/foto_1.webp", dados: new Uint8Array([1, 2, 3, 4]) },
    { nome: "OEBPS/midia/video_1.mp4", dados: mp4 },
  ]);

  const res = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_ok",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });

  assertEquals(res.status, "ativo");
  assertEquals(res.totalImagensInspecionadas, 1);
  assertEquals(res.totalIframesVideoInspecionados, 3);
  assertEquals(env.AI.chamadas.length, 4);

  const versaoBanco = await env.DB.prepare(
    "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
  )
    .bind("sessao_ok", 1)
    .first<{ status_moderacao: string }>();
  assertEquals(versaoBanco?.status_moderacao, "ativo");
});

Deno.test("moderador_midia_ia: bloqueia versão e dispara alerta para alertas.arestaclimb.com em caso de CSAM (451 ou S4) ou NSFW (S12)", async () => {
  const env = new AmbienteFixalogFake();
  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_nsfw",
      1,
      "laudos/sessao_nsfw/v1.epub",
      500,
      "hash",
      "fp",
      "Renato",
      null,
      "{}",
      "[]",
      "em_analise",
      null,
      "2026-11-08T00:00:00Z",
    )
    .run();

  const mp4 = construirMp4ComAtomosStssTeste([1, 301]);
  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midia/video_1.mp4", dados: mp4 },
  ]);

  // Primeiro I-Frame é SAFE, segundo I-Frame aos 10s é detectado como S12 NSFW!
  env.AI.respostasConfiguradas = ["SAFE", "UNSAFE\nS12"];

  const resNsfw = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_nsfw",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });

  assertEquals(resNsfw.status, "bloqueado");
  assertEquals(resNsfw.motivo?.includes("WORKERS_AI_S12_NSFW"), true);

  const alertas = env.requisicoesExternas.filter((r) =>
    r.url.includes("alertas.arestaclimb.com")
  );
  assertEquals(alertas.length, 1);

  // Teste de bloqueio imediato pela camada 1 (Cloudflare CSAM Scanning Tool HTTP 451)
  env.statusSubrequisicaoCsam = 451;
  const resCsamScan = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_nsfw",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });
  assertEquals(resCsamScan.status, "bloqueado");
  assertEquals(resCsamScan.motivo?.includes("CSAM_SCAN_TOOL_MATCH"), true);

  // Teste de bloqueio pela camada 2 (Workers AI S4 CSAM)
  env.statusSubrequisicaoCsam = 200;
  env.AI.respostasConfiguradas = ["UNSAFE S4 CSAM"];
  const resS4 = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_nsfw",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });
  assertEquals(resS4.status, "bloqueado");
  assertEquals(resS4.motivo?.includes("WORKERS_AI_S4_CSAM"), true);
});
