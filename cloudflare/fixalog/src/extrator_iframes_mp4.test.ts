// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  construirMp4ComAtomosStssTeste,
  extrairQuadrosChaveMp4,
  lerIndicesStssMp4,
} from "./extrator_iframes_mp4.ts";

Deno.test("extrator_iframes_mp4: lê tabela moov/stss e extrai quadros-chave I-Frames do vídeo MP4", () => {
  assertEquals(extrairQuadrosChaveMp4(new Uint8Array(0)), []);

  const mp4 = construirMp4ComAtomosStssTeste([1, 301, 601, 901, 1201, 1501, 1800]);
  const indices = lerIndicesStssMp4(mp4);
  assertEquals(indices, [1, 301, 601, 901, 1201, 1501, 1800]);

  const quadros = extrairQuadrosChaveMp4(mp4);
  assertEquals(quadros.length, 7);
  assertEquals(quadros[0].segundoEstimado, 0);
  assertEquals(quadros[1].segundoEstimado, 10);
  assertEquals(quadros[6].segundoEstimado, 60);
  assertEquals(quadros[0].bytesQuadro.byteLength > 0, true);

  // Fallback quando o MP4 não possui átomo stss explícito
  const quadrosFallback = extrairQuadrosChaveMp4(new Uint8Array(140));
  assertEquals(quadrosFallback.length, 7);
});
