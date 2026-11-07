// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { ClienteThumbnailFake } from "./cliente_thumbnail_fake.ts";

Deno.test("cliente_thumbnail_fake: armazena e retorna miniatura WebP em GET, omite corpo em HEAD e retorna 404 quando ausente", async () => {
  const fake = new ClienteThumbnailFake();
  const bytesWebp = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  fake.inserirThumbnail("br_mg_serra_do_cipo", bytesWebp);

  const resGet = await fake.obterThumbnail("br_mg_serra_do_cipo", "GET");
  assertEquals(resGet.status, 200);
  assertEquals(resGet.contentType, "image/webp");
  assertEquals(resGet.corpo, bytesWebp);

  const resHead = await fake.obterThumbnail("br_mg_serra_do_cipo", "HEAD");
  assertEquals(resHead.status, 200);
  assertEquals(resHead.contentType, "image/webp");
  assertEquals(resHead.corpo, null);

  const resAusente = await fake.obterThumbnail("inexistente", "GET");
  assertEquals(resAusente.status, 404);
  assertEquals(resAusente.corpo, null);
  assertEquals(fake.requisicoes.length, 3);
});

Deno.test("cliente_thumbnail_fake: simula falha deterministica de rede quando configurada e restaura operacao ao limpar", async () => {
  const fake = new ClienteThumbnailFake();
  fake.configurarFalha("Timeout ao conectar no R2");

  await assertRejects(
    async () => {
      await fake.obterThumbnail("br_mg_serra_do_cipo", "GET");
    },
    Error,
    "Timeout ao conectar no R2"
  );

  fake.configurarFalha(null);
  const res = await fake.obterThumbnail("br_mg_serra_do_cipo", "GET");
  assertEquals(res.status, 404);
});
