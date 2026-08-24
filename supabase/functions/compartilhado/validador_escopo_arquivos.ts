// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

export interface ResultadoValidacaoEscopo {
  valido: boolean;
  arquivosForaDoEscopo: string[];
}

export function validarEscopoArquivos(caminhosArquivos: string[]): ResultadoValidacaoEscopo {
  if (!caminhosArquivos || caminhosArquivos.length === 0) {
    return {
      valido: false,
      arquivosForaDoEscopo: [],
    };
  }

  const arquivosForaDoEscopo: string[] = [];

  for (const caminho of caminhosArquivos) {
    const caminhoNormalizado = caminho.replace(/\\/g, "/").trim();
    if (!caminhoNormalizado.startsWith("database/")) {
      arquivosForaDoEscopo.push(caminho);
    }
  }

  return {
    valido: arquivosForaDoEscopo.length === 0,
    arquivosForaDoEscopo,
  };
}
