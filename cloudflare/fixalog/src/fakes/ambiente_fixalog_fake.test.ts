// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { AmbienteFixalogFake } from "./ambiente_fixalog_fake.ts";

Deno.test("AmbienteFixalogFake: persiste e consulta chaves, laudos e versões no D1 em memória", async () => {
  const env = new AmbienteFixalogFake();

  await env.DB.prepare(
    "INSERT INTO chaves_usuario_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "fp_123",
      "usr_1",
      "PEM_PUB",
      "PEM_X509",
      "jwt_oidc",
      "google",
      "Renato",
      "FEMERJ",
      "2026-11-08T00:00:00Z",
    )
    .run();

  const chave = await env.DB.prepare(
    "SELECT * FROM chaves_usuario_fixalog WHERE fingerprint_sha256 = ?",
  )
    .bind("fp_123")
    .first<{ nome_declarado: string }>();
  assertEquals(chave?.nome_declarado, "Renato");

  await env.DB.prepare(
    "INSERT INTO laudos_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "laudo_1",
      "usr_1",
      "MANUTENCAO",
      "manutencao_ferragens",
      "Via Aresta",
      null,
      -22.9,
      -43.1,
      1,
      "2026-11-08T00:00:00Z",
      "2026-11-08T00:00:00Z",
    )
    .run();

  await env.DB.prepare(
    "UPDATE laudos_fixalog SET titulo = ?, escalada_uid = ?, latitude = ?, longitude = ?, versao_atual = ?, atualizado_em = ? WHERE id_sessao = ?",
  )
    .bind(
      "Via Aresta v2",
      "esc_1",
      -22.95,
      -43.15,
      2,
      "2026-11-08T01:00:00Z",
      "laudo_1",
    )
    .run();

  const laudo = await env.DB.prepare(
    "SELECT * FROM laudos_fixalog WHERE id_sessao = ?",
  )
    .bind("laudo_1")
    .first<{ titulo: string; versao_atual: number }>();
  assertEquals(laudo?.titulo, "Via Aresta v2");
  assertEquals(laudo?.versao_atual, 2);

  const laudosUsuario = await env.DB.prepare(
    "SELECT * FROM laudos_fixalog WHERE user_id = ?",
  )
    .bind("usr_1")
    .all();
  assertEquals(laudosUsuario.results.length, 1);

  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "laudo_1",
      1,
      "laudos/laudo_1/v1.epub",
      1024,
      "hash_1",
      "fp_123",
      "Renato",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      "2026-11-08T00:00:00Z",
    )
    .run();

  await env.DB.prepare(
    "UPDATE versoes_laudo_fixalog SET status_moderacao = ?, motivo_moderacao = ? WHERE id_sessao = ? AND versao = ?",
  )
    .bind("ativo", null, "laudo_1", 1)
    .run();

  const versao = await env.DB.prepare(
    "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
  )
    .bind("laudo_1", 1)
    .first<{ status_moderacao: string }>();
  assertEquals(versao?.status_moderacao, "ativo");

  const todasVersoes = await env.DB.prepare(
    "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ?",
  )
    .bind("laudo_1")
    .all();
  assertEquals(todasVersoes.results.length, 1);

  const contagem = await env.DB.prepare(
    "SELECT COUNT(DISTINCT id_sessao) AS total FROM versoes_laudo_fixalog WHERE fingerprint_chave = ?",
  )
    .bind("fp_123")
    .first<{ total: number }>();
  assertEquals(contagem?.total, 1);

  env.DB.deveFalhar = true;
  await assertRejects(() =>
    env.DB.prepare("SELECT * FROM laudos_fixalog WHERE id_sessao = ?")
      .bind("laudo_1")
      .all()
  );
  await assertRejects(() =>
    env.DB.prepare("UPDATE laudos_fixalog SET titulo = ? WHERE id_sessao = ?")
      .bind("x", "laudo_1")
      .run()
  );
});

Deno.test("AmbienteFixalogFake: R2 suporta leitura integral e parcial (Byte-Range), Workers AI e fila background", async () => {
  const env = new AmbienteFixalogFake();
  const bytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
  await env.LAUDOS_BUCKET.put("laudos/id/v1.epub", bytes);

  assertEquals(await env.LAUDOS_BUCKET.get("inexistente"), null);

  const parcial = await env.LAUDOS_BUCKET.get("laudos/id/v1.epub", {
    range: { offset: 2, length: 3 },
  });
  assertEquals(parcial?.size, 6);
  const fatia = new Uint8Array(await parcial!.arrayBuffer());
  assertEquals(Array.from(fatia), [30, 40, 50]);

  env.AI.respostasConfiguradas.push("UNSAFE\nS12");
  const r1 = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {});
  const r2 = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {});
  assertEquals(r1.response, "UNSAFE\nS12");
  assertEquals(r2.response, "SAFE");

  let concluido = false;
  env.contexto.waitUntil(
    Promise.resolve().then(() => {
      concluido = true;
    }),
  );
  await env.aguardarTarefasBackground();
  assertEquals(concluido, true);
});
