// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Aresta Contributors

const REGEX_BRANCH_SUGESTAO = /^(?:refs\/heads\/)?(sugestao[-_][a-zA-Z0-9_-]+)$/;

export interface ResultadoValidacaoBranch {
  valida: boolean;
  nomeBranch?: string;
  motivo?: string;
}

export function extrairNomeSimplesBranch(nomeReferencia: string): string {
  if (nomeReferencia.startsWith("refs/heads/")) {
    return nomeReferencia.replace("refs/heads/", "");
  }
  return nomeReferencia;
}

export function validarNomeBranch(nomeReferencia: string): ResultadoValidacaoBranch {
  const nomeLimpo = extrairNomeSimplesBranch(nomeReferencia);

  if (nomeLimpo === "main" || nomeLimpo === "master") {
    return {
      valida: false,
      motivo: "Push para a branch main não é permitido.",
    };
  }

  const correspondencia = nomeReferencia.match(REGEX_BRANCH_SUGESTAO);
  if (!correspondencia) {
    return {
      valida: false,
      motivo: "Apenas branches de sugestão (sugestao-*) são permitidas.",
    };
  }

  return {
    valida: true,
    nomeBranch: correspondencia[1],
  };
}
