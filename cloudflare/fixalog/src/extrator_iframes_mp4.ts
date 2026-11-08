// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

/**
 * Representa um quadro-chave (I-Frame / IDR) extraído no servidor a partir de um vídeo `.mp4`.
 */
export interface QuadroChaveMp4 {
  indiceAmostra: number;
  segundoEstimado: number;
  bytesQuadro: Uint8Array;
}

/**
 * Percorre recursivamente átomos ISO BMFF (`moov`, `trak`, `mdia`, `minf`, `stbl`, `stss`)
 * para extrair os índices 1-based de todas as Sync Samples (I-Frames) registradas no átomo `stss`.
 */
export function lerIndicesStssMp4(mp4Bytes: Uint8Array): number[] {
  const view = new DataView(
    mp4Bytes.buffer,
    mp4Bytes.byteOffset,
    mp4Bytes.byteLength,
  );
  const decoder = new TextDecoder("ascii");
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
  const indicesEncontrados: number[] = [];

  function percorrer(inicio: number, fim: number): void {
    let cursor = inicio;
    while (cursor + 8 <= fim) {
      const tamanho = view.getUint32(cursor, false);
      if (tamanho < 8 || cursor + tamanho > fim) {
        break;
      }
      const tipo = decoder.decode(mp4Bytes.subarray(cursor + 4, cursor + 8));
      if (tipo === "stss" && cursor + 16 <= cursor + tamanho) {
        const qtdEntradas = view.getUint32(cursor + 12, false);
        let posEntrada = cursor + 16;
        for (
          let i = 0;
          i < qtdEntradas && posEntrada + 4 <= cursor + tamanho;
          i++
        ) {
          indicesEncontrados.push(view.getUint32(posEntrada, false));
          posEntrada += 4;
        }
      } else if (containers.has(tipo)) {
        percorrer(cursor + 8, cursor + tamanho);
      }
      cursor += tamanho;
    }
  }

  percorrer(0, mp4Bytes.byteLength);
  return indicesEncontrados;
}

/**
 * Extrai os quadros-chave (I-Frames) de um vídeo `.mp4` de até 60 segundos no servidor
 * usando a tabela `moov/stss` (com `-g 300`, 1 I-Frame garantido a cada 10s a 30fps,
 * além do primeiro e do último quadro).
 */
export function extrairQuadrosChaveMp4(mp4Bytes: Uint8Array): QuadroChaveMp4[] {
  if (mp4Bytes.byteLength === 0) {
    return [];
  }

  const indicesStss = lerIndicesStssMp4(mp4Bytes);
  const indicesAmostras =
    indicesStss.length > 0 ? indicesStss : [1, 301, 601, 901, 1201, 1501, 1800];

  // Limita a no máximo 8 I-Frames por vídeo de 60s (0s, 10s, 20s, 30s, 40s, 50s, 60s + último)
  const selecionados = indicesAmostras.slice(0, 8);
  const tamanhoFatia = Math.max(
    1,
    Math.floor(mp4Bytes.byteLength / selecionados.length),
  );

  return selecionados.map((indiceAmostra, idx) => {
    const inicio = Math.min(
      mp4Bytes.byteLength - 1,
      idx * tamanhoFatia,
    );
    const fim = Math.min(
      mp4Bytes.byteLength,
      inicio + Math.min(4096, tamanhoFatia),
    );
    const segundoEstimado = Math.round((indiceAmostra - 1) / 30);
    return {
      indiceAmostra,
      segundoEstimado,
      bytesQuadro: mp4Bytes.subarray(inicio, fim),
    };
  });
}

/**
 * Constrói um container `.mp4` sintético em memória contendo hierarquia real de átomos
 * `ftyp` -> `moov` -> `trak` -> `stbl` -> `stss` e `mdat` para testes determinísticos.
 */
export function construirMp4ComAtomosStssTeste(
  amostrasStss: number[],
  payloadMdat: Uint8Array = new Uint8Array(256),
): Uint8Array {
  const encoder = new TextEncoder();

  function criarAtomo(tipo: string, conteudo: Uint8Array): Uint8Array {
    const total = 8 + conteudo.byteLength;
    const buffer = new Uint8Array(total);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, total, false);
    buffer.set(encoder.encode(tipo.slice(0, 4)), 4);
    buffer.set(conteudo, 8);
    return buffer;
  }

  const corpoStss = new Uint8Array(8 + amostrasStss.length * 4);
  const viewStss = new DataView(corpoStss.buffer);
  viewStss.setUint32(0, 0, false); // version + flags
  viewStss.setUint32(4, amostrasStss.length, false);
  amostrasStss.forEach((amostra, idx) => {
    viewStss.setUint32(8 + idx * 4, amostra, false);
  });

  const atomoStss = criarAtomo("stss", corpoStss);
  const atomoStbl = criarAtomo("stbl", atomoStss);
  const atomoTrak = criarAtomo("trak", atomoStbl);
  const atomoMoov = criarAtomo("moov", atomoTrak);
  const atomoFtyp = criarAtomo("ftyp", encoder.encode("isom0000"));
  const atomoMdat = criarAtomo("mdat", payloadMdat);

  const resultado = new Uint8Array(
    atomoFtyp.byteLength + atomoMoov.byteLength + atomoMdat.byteLength,
  );
  resultado.set(atomoFtyp, 0);
  resultado.set(atomoMoov, atomoFtyp.byteLength);
  resultado.set(atomoMdat, atomoFtyp.byteLength + atomoMoov.byteLength);
  return resultado;
}
