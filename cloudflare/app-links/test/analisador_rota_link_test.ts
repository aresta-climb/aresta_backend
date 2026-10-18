// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { analisarRotaLink } from "../src/analisador_rota_link.ts";

const UID_VALIDO = "AbCdEfGh123456";

Deno.test("analisador_rota_link: resolve rota direta /<uid> sem prefixo nem UTMs", () => {
  const resultado = analisarRotaLink(new URL(`https://aresta.cc/${UID_VALIDO}`));

  assertEquals(resultado, {
    uid: UID_VALIDO,
    prefixo: null,
    abrir_mapa: false,
    origem_link: null,
    utm_source: null,
    utm_medium: null,
  });
});

Deno.test("analisador_rota_link: resolve rota /m/<uid> ativando abertura no mapa sem origem de campanha", () => {
  const resultado = analisarRotaLink(new URL(`https://aresta.cc/m/${UID_VALIDO}`));

  assertEquals(resultado, {
    uid: UID_VALIDO,
    prefixo: "m",
    abrir_mapa: true,
    origem_link: null,
    utm_source: null,
    utm_medium: null,
  });
});

Deno.test("analisador_rota_link: resolve rota /s/<uid> como compartilhamento social sem abrir mapa", () => {
  const resultado = analisarRotaLink(new URL(`https://aresta.cc/s/${UID_VALIDO}`));

  assertEquals(resultado, {
    uid: UID_VALIDO,
    prefixo: "s",
    abrir_mapa: false,
    origem_link: "compartilhamento",
    utm_source: "compartilhamento",
    utm_medium: "social",
  });
});

Deno.test("analisador_rota_link: resolve rotas /sm/<uid> e /ms/<uid> como compartilhamento com abertura no mapa", () => {
  for (const prefixo of ["sm", "ms"]) {
    const resultado = analisarRotaLink(
      new URL(`https://aresta.cc/${prefixo}/${UID_VALIDO}`)
    );

    assertEquals(resultado, {
      uid: UID_VALIDO,
      prefixo,
      abrir_mapa: true,
      origem_link: "compartilhamento",
      utm_source: "compartilhamento",
      utm_medium: "social",
    });
  }
});

Deno.test("analisador_rota_link: resolve rota /q/<uid> como placa QR Code na rocha sem abrir mapa", () => {
  const resultado = analisarRotaLink(new URL(`https://aresta.cc/q/${UID_VALIDO}`));

  assertEquals(resultado, {
    uid: UID_VALIDO,
    prefixo: "q",
    abrir_mapa: false,
    origem_link: "qrcode",
    utm_source: "placa_rocha",
    utm_medium: "qrcode",
  });
});

Deno.test("analisador_rota_link: resolve rotas /qm/<uid> e /mq/<uid> como QR Code na rocha com abertura no mapa", () => {
  for (const prefixo of ["qm", "mq"]) {
    const resultado = analisarRotaLink(
      new URL(`https://aresta.cc/${prefixo}/${UID_VALIDO}`)
    );

    assertEquals(resultado, {
      uid: UID_VALIDO,
      prefixo,
      abrir_mapa: true,
      origem_link: "qrcode",
      utm_source: "placa_rocha",
      utm_medium: "qrcode",
    });
  }
});

Deno.test("analisador_rota_link: prioriza query params utm_source e utm_medium explicitos sobre o padrao do prefixo", () => {
  const resultado = analisarRotaLink(
    new URL(
      `https://aresta.cc/s/${UID_VALIDO}?utm_source=whatsapp&utm_medium=grupo_escalada`
    )
  );

  assertEquals(resultado, {
    uid: UID_VALIDO,
    prefixo: "s",
    abrir_mapa: false,
    origem_link: "compartilhamento",
    utm_source: "whatsapp",
    utm_medium: "grupo_escalada",
  });
});

Deno.test("analisador_rota_link: ignora barras finais na rota ao extrair segmentos", () => {
  const resultado = analisarRotaLink(
    new URL(`https://aresta.cc/s/${UID_VALIDO}/`)
  );

  assertEquals(resultado?.uid, UID_VALIDO);
  assertEquals(resultado?.prefixo, "s");
});

Deno.test("analisador_rota_link: retorna null para UIDs fora do padrao de 14 caracteres alfanumericos ou prefixos invalidos", () => {
  const urlsInvalidas = [
    "https://aresta.cc/",
    "https://aresta.cc/curto123",
    "https://aresta.cc/longo1234567890123",
    "https://aresta.cc/AbCdEfGh12345!",
    `https://aresta.cc/x/${UID_VALIDO}`,
    `https://aresta.cc/s/${UID_VALIDO}/extra`,
  ];

  for (const urlTexto of urlsInvalidas) {
    assertEquals(analisarRotaLink(new URL(urlTexto)), null);
  }
});
