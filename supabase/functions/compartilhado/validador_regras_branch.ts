// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

const REGEX_BRANCH_EDICAO = /^(?:refs\/heads\/)?((?:edicao|sugestao)[-_][a-zA-Z0-9_-]+)$/;

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

  const correspondencia = nomeReferencia.match(REGEX_BRANCH_EDICAO);
  if (!correspondencia) {
    return {
      valida: false,
      motivo: "Apenas branches de edição (edicao-*) são permitidas.",
    };
  }

  return {
    valida: true,
    nomeBranch: correspondencia[1],
  };
}
