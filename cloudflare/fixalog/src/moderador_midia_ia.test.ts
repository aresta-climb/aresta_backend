// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { construirZipEpubEmMemoria } from "./extrator_indice_epub.ts";
import { AmbienteFixalogFake } from "./fakes/ambiente_fixalog_fake.ts";
import {
  classificarRespostaModeracaoVision,
  executarModeracaoAssincronaLaudo,
  gerarTokenHmacCsamScan,
  verificarTokenHmacCsamScan,
} from "./moderador_midia_ia.ts";

Deno.test("moderador_midia_ia: aprova fotos, poster e keyframes de vídeo (_kf_*s.jpg), aceita licença 5016 automaticamente e promove status para ativo", async () => {
  const env = new AmbienteFixalogFake();
  env.AI.exigirAgreeNaPrimeiraChamada = true;

  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      0,
      1,
      "2026-11-08T00:00:00Z",
    )
    .run();

  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midias/foto_1.webp", dados: new Uint8Array([1, 2, 3, 4]) },
    { nome: "OEBPS/midias/video_1.mp4", dados: new Uint8Array([0, 0, 0, 24]) },
    {
      nome: "OEBPS/midias/video_1_poster.jpg",
      dados: new Uint8Array([10, 20, 30]),
    },
    {
      nome: "OEBPS/midias/video_1_kf_10s.jpg",
      dados: new Uint8Array([40, 50, 60]),
    },
    {
      nome: "OEBPS/midias/video_1_kf_20s.jpg",
      dados: new Uint8Array([70, 80, 90]),
    },
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
  assertEquals(env.AI.licencaAceita, true);
  // 1 tentativa inicial (erro 5016) + 1 prompt 'agree' + 4 imagens classificadas = 6 chamadas
  assertEquals(env.AI.chamadas.length, 6);

  // Verifica que a sub-requisição CSAM usou método GET com token HMAC válido
  const chamadasCsam = env.requisicoesExternas.filter((r) =>
    r.url.includes("/__csam_scan/")
  );
  assertEquals(chamadasCsam.length, 4);
  assertEquals(chamadasCsam[0].init?.method, "GET");

  const tokenValido = await gerarTokenHmacCsamScan({
    idSessao: "sessao_ok",
    versao: 1,
    caminho: "OEBPS/midias/foto_1.webp",
    segredo: env.SENTRY_DSN,
  });
  assertEquals(
    await verificarTokenHmacCsamScan({
      idSessao: "sessao_ok",
      versao: 1,
      caminho: "OEBPS/midias/foto_1.webp",
      token: tokenValido,
      segredo: env.SENTRY_DSN,
    }),
    true,
  );
  assertEquals(
    await verificarTokenHmacCsamScan({
      idSessao: "sessao_ok",
      versao: 1,
      caminho: "OEBPS/midias/foto_1.webp",
      token: "invalido",
      segredo: env.SENTRY_DSN,
    }),
    false,
  );

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
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      0,
      1,
      "2026-11-08T00:00:00Z",
    )
    .run();

  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midias/video_1.mp4", dados: new Uint8Array([1, 2, 3]) },
    {
      nome: "OEBPS/midias/video_1_poster.jpg",
      dados: new Uint8Array([10, 20]),
    },
    {
      nome: "OEBPS/midias/video_1_kf_10s.jpg",
      dados: new Uint8Array([30, 40]),
    },
  ]);

  // Poster é SAFE, keyframe aos 10s é detectado como S12 NSFW!
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

Deno.test("moderador_midia_ia: opera em modo estritamente fail-closed e dispara emergência fatal no Sentry quando CSAM scan falha, Workers AI falha ou vídeo MP4 não tem poster", async () => {
  const env = new AmbienteFixalogFake();
  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_fail_closed",
      1,
      "laudos/sessao_fail_closed/v1.epub",
      1500,
      "hash",
      "fp",
      "Renato",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      0,
      1,
      "2026-11-10T00:00:00Z",
    )
    .run();

  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midias/foto_1.webp", dados: new Uint8Array(600) },
  ]);

  // 1. Falha técnica no Workers AI -> DEVE bloquear (fail-closed) e enviar evento fatal ao Sentry
  env.AI.deveFalhar = true;
  const resFalhaIa = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_fail_closed",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });
  assertEquals(resFalhaIa.status, "bloqueado");
  assertEquals(
    resFalhaIa.motivo?.includes("ERRO_TECNICO_VERIFICACAO:WORKERS_AI_FALHA"),
    true,
  );

  const versaoAposFalhaIa = await env.DB.prepare(
    "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
  )
    .bind("sessao_fail_closed", 1)
    .first<{ status_moderacao: string; motivo_moderacao: string }>();
  assertEquals(versaoAposFalhaIa?.status_moderacao, "bloqueado");

  const envelopesSentry = env.requisicoesExternas.filter((r) =>
    r.url.includes("ingest.us.sentry.io")
  );
  assertEquals(envelopesSentry.length >= 1, true);
  const corpoUltimoEnvelope = String(
    envelopesSentry[envelopesSentry.length - 1].init?.body ?? "",
  );
  assertEquals(corpoUltimoEnvelope.includes('"level":"fatal"'), true);

  // 2. Falha técnica HTTP 500 na sub-requisição CSAM -> DEVE bloquear (fail-closed)
  env.AI.deveFalhar = false;
  env.statusSubrequisicaoCsam = 500;
  const resFalhaCsam = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_fail_closed",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });
  assertEquals(resFalhaCsam.status, "bloqueado");
  assertEquals(
    resFalhaCsam.motivo?.includes(
      "ERRO_TECNICO_VERIFICACAO:CSAM_SCAN_HTTP_500",
    ),
    true,
  );

  // 3. Vídeo MP4 sem imagem de poster empacotada -> DEVE bloquear (fail-closed)
  env.statusSubrequisicaoCsam = 200;
  const epubVideoSemPoster = construirZipEpubEmMemoria([
    { nome: "OEBPS/midias/video_orfao.mp4", dados: new Uint8Array([1, 2, 3]) },
  ]);
  const resSemPoster = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_fail_closed",
    versao: 1,
    userId: "usr_1",
    epubBytes: epubVideoSemPoster,
  });
  assertEquals(resSemPoster.status, "bloqueado");
  assertEquals(
    resSemPoster.motivo?.includes("ERRO_TECNICO_VERIFICACAO:VIDEO_SEM_POSTER"),
    true,
  );
});

Deno.test("moderador_midia_ia: em produção sem fetchExterno evita sub-requisição loopback same-zone (HTTP 522) e popula Cache de Borda para o CSAM Scanning Tool", async () => {
  const env = new AmbienteFixalogFake();
  // Simula o runtime de produção do Cloudflare Worker onde fetchExterno não existe
  (env as { fetchExterno?: unknown }).fetchExterno = undefined;

  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_prod_sem_loopback",
      1,
      "laudos/sessao_prod_sem_loopback/v1.epub",
      1500,
      "hash",
      "fp",
      "Renato",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      0,
      1,
      "2026-11-10T00:00:00Z",
    )
    .run();

  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midias/foto_prod.webp", dados: new Uint8Array(600) },
  ]);

  const fetchOriginal = globalThis.fetch;
  try {
    // No Cloudflare Workers, fetch() para a própria zona Worker-only retorna HTTP 522
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url.startsWith("https://fixalog.app/")) {
        return new Response("Origin Connection Time-out", { status: 522 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const resultado = await executarModeracaoAssincronaLaudo({
      env,
      idSessao: "sessao_prod_sem_loopback",
      versao: 1,
      userId: "usr_1",
      epubBytes: epub,
    });

    assertEquals(resultado.status, "ativo");
    assertEquals(resultado.motivo, null);
    assertEquals(resultado.totalImagensInspecionadas, 1);

    // Verifica que a imagem foi registrada no Cache de Borda da zona para inspeção CSAM
    const chavesCache = Array.from(env.cacheBorda.entradas.keys());
    assertEquals(
      chavesCache.some((u) =>
        u.includes("/__csam_scan/sessao_prod_sem_loopback/v1/OEBPS/midias/foto_prod.webp")
      ),
      true,
    );
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("moderador_midia_ia: não gera falso-positivo quando o modelo Llama 3.2 Vision responde SAFE citando ausência de S4/CSAM ou S12/NSFW", async () => {
  const env = new AmbienteFixalogFake();
  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_safe_verboso",
      1,
      "laudos/sessao_safe_verboso/v1.epub",
      1500,
      "hash",
      "fp",
      "Renato",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      0,
      2,
      "2026-11-10T00:00:00Z",
    )
    .run();

  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midias/foto_1.webp", dados: new Uint8Array(600) },
    { nome: "OEBPS/midias/video_1_poster.jpg", dados: new Uint8Array(600) },
  ]);

  env.AI.respostasConfiguradas = [
    "SAFE. This climbing hardware image does not contain S4 (CSAM) or S12 (NSFW/Sexual/Gore).",
    "This image shows page 2 of a technical PDF document (`_p2.webp`). There are no severe violations like S4 (child sexual abuse material / CSAM) or S12 (explicit nudity, pornography, or extreme gore), so the image is SAFE.",
  ];

  const resultado = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_safe_verboso",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });

  assertEquals(resultado.status, "ativo");
  assertEquals(resultado.motivo, null);
});

Deno.test("moderador_midia_ia: solicita JSON determinístico (temperature=0) separando reasoning de verdict e ignora termos S4/S12/UNSAFE dentro de reasoning", async () => {
  const env = new AmbienteFixalogFake();
  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_json_verdict",
      1,
      "laudos/sessao_json_verdict/v1.epub",
      1500,
      "hash",
      "fp",
      "Renato",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      0,
      1,
      "2026-11-10T00:00:00Z",
    )
    .run();

  const epub = construirZipEpubEmMemoria([
    { nome: "OEBPS/midias/doc_p2.webp", dados: new Uint8Array(600) },
  ]);

  // Mesmo se o reasoning contiver palavras como UNSAFE, NOT SAFE, S4 ou S12,
  // o campo estruturado "verdict": "SAFE" tem precedência absoluta.
  env.AI.respostasConfiguradas = [
    '```json\n{"reasoning": "Technical document discussing why a corroded bolt is UNSAFE and NOT SAFE for climbing; no S4 or S12 content.", "verdict": "SAFE"}\n```',
  ];

  const resultado = await executarModeracaoAssincronaLaudo({
    env,
    idSessao: "sessao_json_verdict",
    versao: 1,
    userId: "usr_1",
    epubBytes: epub,
  });

  assertEquals(resultado.status, "ativo");
  assertEquals(resultado.motivo, null);
  assertEquals(env.AI.chamadas[0].entrada.temperature, 0);
  assertEquals(typeof env.AI.chamadas[0].entrada.max_tokens, "number");

  assertEquals(
    classificarRespostaModeracaoVision(
      '{"reasoning": "Safe looking background, but contains explicit nudity", "verdict": "UNSAFE_S12"}',
    ),
    "S12_NSFW",
  );
  assertEquals(
    classificarRespostaModeracaoVision(
      '{"reasoning": "Child exploitation material detected", "verdict": "UNSAFE_S4"}',
    ),
    "S4_CSAM",
  );
});
