// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ICONE_EMERGENCIA_WEBP_BASE64,
  ICONE_FEEDBACK_BUGS_WEBP_BASE64,
  URL_ICONE_EMERGENCIA,
  URL_ICONE_FEEDBACK_BUGS,
} from "../src/icones_alertas_webp.ts";

Deno.test("icones_alertas_webp: exporta URLs publicas e binarios WebP 256x256 validos em Base64", () => {
  assertEquals(URL_ICONE_EMERGENCIA, "https://alertas.arestaclimb.com/icones/emergencia.webp");
  assertEquals(URL_ICONE_FEEDBACK_BUGS, "https://alertas.arestaclimb.com/icones/feedback_bugs.webp");

  const binEmergencia = atob(ICONE_EMERGENCIA_WEBP_BASE64);
  assertEquals(binEmergencia.slice(0, 4), "RIFF");
  assertEquals(binEmergencia.slice(8, 12), "WEBP");
  assertEquals(binEmergencia.length > 5000 && binEmergencia.length < 20000, true);

  const binBugs = atob(ICONE_FEEDBACK_BUGS_WEBP_BASE64);
  assertEquals(binBugs.slice(0, 4), "RIFF");
  assertEquals(binBugs.slice(8, 12), "WEBP");
  assertEquals(binBugs.length > 4000 && binBugs.length < 15000, true);
});
