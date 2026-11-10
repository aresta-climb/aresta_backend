// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { BucketR2Fixalog } from "./fakes/ambiente_fixalog_fake.ts";

/**
 * Metadados de deslocamento de um arquivo empacotado dentro do container ZIP/EPUB 3.
 */
export interface EntradaIndiceZipEpub {
  offset: number;
  length: number;
  metodo: number;
  tamanhoDescomprimido: number;
  mimeType: string;
}

export type MapaIndiceZipEpub = Record<string, EntradaIndiceZipEpub>;

export const CABECALHO_CACHE_MIDIA_IMUTAVEL =
  "public, max-age=31536000, s-maxage=31536000, immutable";

/**
 * Infere o MIME type pelo caminho interno do arquivo no EPUB 3.
 */
export function inferirMimeTypeCaminho(caminho: string): string {
  const lower = caminho.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xhtml") || lower.endsWith(".html")) {
    return "application/xhtml+xml; charset=utf-8";
  }
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".xml") || lower.endsWith(".opf")) {
    return "application/xml; charset=utf-8";
  }
  return "application/octet-stream";
}

/**
 * Lê o Diretório Central ZIP do pacote `.epub` e retorna o mapa de offsets exatos
 * (`offset`, `length`, `metodo`, `mimeType`) de cada entrada interna.
 */
export function extrairIndiceZipEpub(
  epubBytes: Uint8Array,
): MapaIndiceZipEpub {
  const view = new DataView(
    epubBytes.buffer,
    epubBytes.byteOffset,
    epubBytes.byteLength,
  );

  // Localiza o End of Central Directory Record (PK\x05\x06 = 0x06054b50)
  let offsetEocd = -1;
  const limiteBusca = Math.max(0, epubBytes.byteLength - 65557);
  for (let i = epubBytes.byteLength - 22; i >= limiteBusca; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      offsetEocd = i;
      break;
    }
  }

  if (offsetEocd < 0) {
    throw new Error("Container EPUB inválido: registro EOCD ZIP não encontrado.");
  }

  const totalEntradas = view.getUint16(offsetEocd + 10, true);
  const offsetDiretorioCentral = view.getUint32(offsetEocd + 16, true);
  const decoder = new TextDecoder();
  const indice: MapaIndiceZipEpub = {};

  let cursor = offsetDiretorioCentral;
  for (let i = 0; i < totalEntradas; i++) {
    if (
      cursor + 46 > epubBytes.byteLength ||
      view.getUint32(cursor, true) !== 0x02014b50
    ) {
      throw new Error(
        "Container EPUB inválido: cabeçalho do Diretório Central ZIP corrompido.",
      );
    }

    const metodo = view.getUint16(cursor + 10, true);
    const tamanhoComprimido = view.getUint32(cursor + 20, true);
    const tamanhoDescomprimido = view.getUint32(cursor + 24, true);
    const tamanhoNome = view.getUint16(cursor + 28, true);
    const tamanhoExtraCentral = view.getUint16(cursor + 30, true);
    const tamanhoComentario = view.getUint16(cursor + 32, true);
    const offsetHeaderLocal = view.getUint32(cursor + 42, true);

    const nomeBytes = epubBytes.subarray(
      cursor + 46,
      cursor + 46 + tamanhoNome,
    );
    const nomeArquivo = decoder.decode(nomeBytes);

    if (
      offsetHeaderLocal + 30 > epubBytes.byteLength ||
      view.getUint32(offsetHeaderLocal, true) !== 0x04034b50
    ) {
      throw new Error(
        `Container EPUB inválido: Local File Header ausente para ${nomeArquivo}.`,
      );
    }

    const tamanhoNomeLocal = view.getUint16(offsetHeaderLocal + 26, true);
    const tamanhoExtraLocal = view.getUint16(offsetHeaderLocal + 28, true);
    const offsetDados =
      offsetHeaderLocal + 30 + tamanhoNomeLocal + tamanhoExtraLocal;

    indice[nomeArquivo] = {
      offset: offsetDados,
      length: tamanhoComprimido,
      metodo,
      tamanhoDescomprimido,
      mimeType: inferirMimeTypeCaminho(nomeArquivo),
    };

    cursor += 46 + tamanhoNome + tamanhoExtraCentral + tamanhoComentario;
  }

  return indice;
}

/**
 * Extrai os bytes descomprimidos de um arquivo interno do `.epub` (suporta STORE=0 e DEFLATE=8).
 */
export async function extrairArquivoDoEpub(
  epubBytes: Uint8Array,
  caminhoInterno: string,
  indicePreCalculado?: MapaIndiceZipEpub,
): Promise<Uint8Array | null> {
  const indice = indicePreCalculado ?? extrairIndiceZipEpub(epubBytes);
  const entrada = indice[caminhoInterno];
  if (!entrada) {
    return null;
  }

  const fatia = epubBytes.subarray(
    entrada.offset,
    entrada.offset + entrada.length,
  );
  if (entrada.metodo === 0) {
    return fatia;
  }

  if (entrada.metodo === 8) {
    const stream = new Blob([new Uint8Array(fatia)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  throw new Error(`Método de compressão ZIP não suportado: ${entrada.metodo}`);
}

/**
 * Lê uma entrada específica de um `.epub` no R2 usando Byte-Range e descomprime automaticamente
 * caso esteja armazenada com `DEFLATE` (`metodo === 8`).
 */
export async function lerBytesEntradaDoR2(params: {
  bucket: BucketR2Fixalog;
  r2Key: string;
  entrada: EntradaIndiceZipEpub;
}): Promise<Uint8Array | null> {
  const { bucket, r2Key, entrada } = params;
  const objeto = await bucket.get(r2Key, {
    range: { offset: entrada.offset, length: entrada.length },
  });
  if (!objeto) {
    return null;
  }
  const fatia = new Uint8Array(await objeto.arrayBuffer());
  if (entrada.metodo === 0) {
    return fatia;
  }
  if (entrada.metodo === 8) {
    const stream = new Blob([new Uint8Array(fatia)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }
  throw new Error(`Método de compressão ZIP não suportado: ${entrada.metodo}`);
}

/**
 * Resolve uma requisição HTTP (integral `200 OK` ou parcial `206 Partial Content`)
 * para uma mídia armazenada dentro do `.epub` no Cloudflare R2.
 */
export async function servirMidiaByteRangeDoR2(params: {
  bucket: BucketR2Fixalog;
  r2Key: string;
  entrada: EntradaIndiceZipEpub;
  cabecalhoRange?: string | null;
}): Promise<Response> {
  const { bucket, r2Key, entrada, cabecalhoRange } = params;

  if (!cabecalhoRange || !cabecalhoRange.trim().startsWith("bytes=")) {
    const bytesDescomprimidos = await lerBytesEntradaDoR2({
      bucket,
      r2Key,
      entrada,
    });
    if (!bytesDescomprimidos) {
      return new Response("Pacote EPUB não encontrado no R2.", { status: 404 });
    }
    return new Response(new Uint8Array(bytesDescomprimidos), {
      status: 200,
      headers: {
        "Content-Type": entrada.mimeType,
        "Content-Length": String(bytesDescomprimidos.byteLength),
        "Accept-Ranges": "bytes",
        "Cache-Control": CABECALHO_CACHE_MIDIA_IMUTAVEL,
      },
    });
  }

  const expressao = cabecalhoRange.trim().slice("bytes=".length);
  const [inicioStr, fimStr] = expressao.split("-");
  const tamanhoTotal = entrada.length;

  let inicio = inicioStr ? Number.parseInt(inicioStr, 10) : 0;
  let fim = fimStr ? Number.parseInt(fimStr, 10) : tamanhoTotal - 1;

  if (
    Number.isNaN(inicio) ||
    Number.isNaN(fim) ||
    inicio < 0 ||
    fim < inicio ||
    inicio >= tamanhoTotal
  ) {
    return new Response("Intervalo de bytes inválido.", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${tamanhoTotal}`,
      },
    });
  }

  if (fim >= tamanhoTotal) {
    fim = tamanhoTotal - 1;
  }

  const comprimentoFatia = fim - inicio + 1;
  const objeto = await bucket.get(r2Key, {
    range: {
      offset: entrada.offset + inicio,
      length: comprimentoFatia,
    },
  });

  if (!objeto) {
    return new Response("Pacote EPUB não encontrado no R2.", { status: 404 });
  }

  const bytes = await objeto.arrayBuffer();
  return new Response(bytes, {
    status: 206,
    headers: {
      "Content-Type": entrada.mimeType,
      "Content-Length": String(comprimentoFatia),
      "Content-Range": `bytes ${inicio}-${fim}/${tamanhoTotal}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": CABECALHO_CACHE_MIDIA_IMUTAVEL,
    },
  });
}

/**
 * Constrói um pacote ZIP/EPUB 3 válido em memória (com entradas em modo STORE=0 ou DEFLATE=8)
 * para testes determinísticos de extração de Diretório Central e Byte-Range.
 */
export function construirZipEpubEmMemoria(
  arquivos: Array<{ nome: string; dados: Uint8Array; metodo?: number }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const partesLocais: Uint8Array[] = [];
  const partesCentrais: Uint8Array[] = [];
  let offsetAtual = 0;

  for (const arq of arquivos) {
    const nomeBytes = encoder.encode(arq.nome);
    const metodo = arq.metodo ?? 0;
    const tamanho = arq.dados.byteLength;

    const headerLocal = new Uint8Array(30 + nomeBytes.byteLength);
    const viewLocal = new DataView(headerLocal.buffer);
    viewLocal.setUint32(0, 0x04034b50, true);
    viewLocal.setUint16(4, 20, true);
    viewLocal.setUint16(8, metodo, true);
    viewLocal.setUint32(18, tamanho, true);
    viewLocal.setUint32(22, tamanho, true);
    viewLocal.setUint16(26, nomeBytes.byteLength, true);
    headerLocal.set(nomeBytes, 30);

    const headerCentral = new Uint8Array(46 + nomeBytes.byteLength);
    const viewCentral = new DataView(headerCentral.buffer);
    viewCentral.setUint32(0, 0x02014b50, true);
    viewCentral.setUint16(4, 20, true);
    viewCentral.setUint16(6, 20, true);
    viewCentral.setUint16(10, metodo, true);
    viewCentral.setUint32(20, tamanho, true);
    viewCentral.setUint32(24, tamanho, true);
    viewCentral.setUint16(28, nomeBytes.byteLength, true);
    viewCentral.setUint32(42, offsetAtual, true);
    headerCentral.set(nomeBytes, 46);

    partesLocais.push(headerLocal, arq.dados);
    partesCentrais.push(headerCentral);
    offsetAtual += headerLocal.byteLength + tamanho;
  }

  const tamanhoCentral = partesCentrais.reduce(
    (acc, p) => acc + p.byteLength,
    0,
  );
  const eocd = new Uint8Array(22);
  const viewEocd = new DataView(eocd.buffer);
  viewEocd.setUint32(0, 0x06054b50, true);
  viewEocd.setUint16(8, arquivos.length, true);
  viewEocd.setUint16(10, arquivos.length, true);
  viewEocd.setUint32(12, tamanhoCentral, true);
  viewEocd.setUint32(16, offsetAtual, true);

  const totalBytes = offsetAtual + tamanhoCentral + 22;
  const resultado = new Uint8Array(totalBytes);
  let pos = 0;
  for (const p of partesLocais) {
    resultado.set(p, pos);
    pos += p.byteLength;
  }
  for (const p of partesCentrais) {
    resultado.set(p, pos);
    pos += p.byteLength;
  }
  resultado.set(eocd, pos);
  return resultado;
}
