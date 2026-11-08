// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  CABECALHO_CACHE_MIDIA_IMUTAVEL,
  construirZipEpubEmMemoria,
  extrairArquivoDoEpub,
  extrairIndiceZipEpub,
  inferirMimeTypeCaminho,
  servirMidiaByteRangeDoR2,
} from "./extrator_indice_epub.ts";
import { BucketR2FixalogFake } from "./fakes/ambiente_fixalog_fake.ts";

Deno.test("extrator_indice_epub: extrai Diretório Central ZIP e serve fatias 200 OK e 206 Partial Content do R2", async () => {
  const encoder = new TextEncoder();
  const videoBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const fotoBytes = new Uint8Array([100, 101, 102, 103]);
  const xhtmlBytes = encoder.encode("<html><body>Laudo</body></html>");

  const epub = construirZipEpubEmMemoria([
    { nome: "mimetype", dados: encoder.encode("application/epub+zip") },
    { nome: "OEBPS/relatorio.xhtml", dados: xhtmlBytes },
    { nome: "OEBPS/midia/video_1.mp4", dados: videoBytes },
    { nome: "OEBPS/midia/foto_1.webp", dados: fotoBytes },
  ]);

  const indice = extrairIndiceZipEpub(epub);
  assertEquals(indice["OEBPS/midia/video_1.mp4"].length, 10);
  assertEquals(indice["OEBPS/midia/video_1.mp4"].mimeType, "video/mp4");
  assertEquals(indice["OEBPS/midia/foto_1.webp"].mimeType, "image/webp");

  const extraidoXhtml = await extrairArquivoDoEpub(
    epub,
    "OEBPS/relatorio.xhtml",
    indice,
  );
  assertEquals(
    new TextDecoder().decode(extraidoXhtml!),
    "<html><body>Laudo</body></html>",
  );
  assertEquals(await extrairArquivoDoEpub(epub, "nao_existe", indice), null);

  const bucket = new BucketR2FixalogFake();
  await bucket.put("laudos/sessao_1/v1.epub", epub);

  // Leitura integral 200 OK sem cabeçalho Range
  const res200 = await servirMidiaByteRangeDoR2({
    bucket,
    r2Key: "laudos/sessao_1/v1.epub",
    entrada: indice["OEBPS/midia/foto_1.webp"],
  });
  assertEquals(res200.status, 200);
  assertEquals(
    res200.headers.get("Cache-Control"),
    CABECALHO_CACHE_MIDIA_IMUTAVEL,
  );
  assertEquals(
    Array.from(new Uint8Array(await res200.arrayBuffer())),
    [100, 101, 102, 103],
  );

  // Leitura parcial 206 Partial Content com cabeçalho Range: bytes=2-6
  const res206 = await servirMidiaByteRangeDoR2({
    bucket,
    r2Key: "laudos/sessao_1/v1.epub",
    entrada: indice["OEBPS/midia/video_1.mp4"],
    cabecalhoRange: "bytes=2-6",
  });
  assertEquals(res206.status, 206);
  assertEquals(res206.headers.get("Content-Range"), "bytes 2-6/10");
  assertEquals(res206.headers.get("Content-Length"), "5");
  assertEquals(
    Array.from(new Uint8Array(await res206.arrayBuffer())),
    [2, 3, 4, 5, 6],
  );

  // Range aberto no fim (bytes=7-)
  const res206Fim = await servirMidiaByteRangeDoR2({
    bucket,
    r2Key: "laudos/sessao_1/v1.epub",
    entrada: indice["OEBPS/midia/video_1.mp4"],
    cabecalhoRange: "bytes=7-99",
  });
  assertEquals(res206Fim.status, 206);
  assertEquals(res206Fim.headers.get("Content-Range"), "bytes 7-9/10");
  assertEquals(
    Array.from(new Uint8Array(await res206Fim.arrayBuffer())),
    [7, 8, 9],
  );

  // Range inválido -> 416
  const res416 = await servirMidiaByteRangeDoR2({
    bucket,
    r2Key: "laudos/sessao_1/v1.epub",
    entrada: indice["OEBPS/midia/video_1.mp4"],
    cabecalhoRange: "bytes=50-60",
  });
  assertEquals(res416.status, 416);

  // Chave ausente no R2 -> 404
  const res404 = await servirMidiaByteRangeDoR2({
    bucket,
    r2Key: "inexistente",
    entrada: indice["OEBPS/midia/video_1.mp4"],
  });
  assertEquals(res404.status, 404);
});

Deno.test("extrator_indice_epub: suporta descompressão DEFLATE, MIME types e rejeita ZIP corrompido", async () => {
  assertEquals(inferirMimeTypeCaminho("a.jpg"), "image/jpeg");
  assertEquals(inferirMimeTypeCaminho("a.png"), "image/png");
  assertEquals(inferirMimeTypeCaminho("a.pdf"), "application/pdf");
  assertEquals(
    inferirMimeTypeCaminho("a.css"),
    "text/css; charset=utf-8",
  );
  assertEquals(
    inferirMimeTypeCaminho("a.xml"),
    "application/xml; charset=utf-8",
  );
  assertEquals(
    inferirMimeTypeCaminho("a.bin"),
    "application/octet-stream",
  );

  const textoOriginal = new TextEncoder().encode(" Conteúdo comprimido DEFLATE ");
  const streamComp = new Blob([textoOriginal])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const comprimido = new Uint8Array(await new Response(streamComp).arrayBuffer());

  const epubDeflate = construirZipEpubEmMemoria([
    { nome: "OEBPS/estilo.css", dados: comprimido, metodo: 8 },
  ]);
  const descomprimido = await extrairArquivoDoEpub(
    epubDeflate,
    "OEBPS/estilo.css",
  );
  assertEquals(
    new TextDecoder().decode(descomprimido!),
    " Conteúdo comprimido DEFLATE ",
  );

  assertThrows(() => extrairIndiceZipEpub(new Uint8Array([1, 2, 3])));
});
