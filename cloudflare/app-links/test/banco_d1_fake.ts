// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  LinhaCatalogoAresta,
  LinhaCatalogoCroquis,
} from "../../../aresta_api/sql/generated/ts/catalogo_sql.ts";
import {
  BancoD1,
  DeclaracaoPreparadaD1,
} from "../src/resolvedor_entidade_d1.ts";

/**
 * Fake determinístico em memória do banco Cloudflare D1 (`aresta-catalogo`).
 *
 * Mantém as tabelas `catalogo_croquis` e `catalogo_aresta` em memória,
 * resolvendo as consultas parametrizadas de croqui e entidade (incluindo `JOIN`
 * com croqui, setor pai e grupo pai) e permitindo simular falhas determinísticas de I/O.
 */
export class BancoD1Fake implements BancoD1 {
  private readonly croquis = new Map<string, LinhaCatalogoCroquis>();
  private readonly entidades = new Map<string, LinhaCatalogoAresta>();
  private mensagemFalhaAtiva: string | null = null;

  /**
   * Configura ou limpa uma falha determinística de I/O que será lançada em `all()`.
   */
  configurarFalha(mensagemErro: string | null): void {
    this.mensagemFalhaAtiva = mensagemErro;
  }

  /**
   * Insere ou atualiza um registro na tabela `catalogo_croquis` em memória.
   */
  inserirCroqui(croqui: LinhaCatalogoCroquis): void {
    this.croquis.set(croqui.croqui_uid, { ...croqui });
  }

  /**
   * Insere ou atualiza um registro na tabela `catalogo_aresta` em memória.
   */
  inserirEntidade(entidade: LinhaCatalogoAresta): void {
    this.entidades.set(entidade.uid, { ...entidade });
  }

  /**
   * Prepara uma consulta SQL compatível com a interface `D1Database.prepare(query)` do Cloudflare Workers.
   */
  prepare(query: string): DeclaracaoPreparadaD1 {
    return this.criarDeclaracao(query, []);
  }

  private criarDeclaracao(
    query: string,
    parametros: unknown[]
  ): DeclaracaoPreparadaD1 {
    return {
      bind: (...valores: unknown[]) => {
        return this.criarDeclaracao(query, valores);
      },
      all: <T = Record<string, unknown>>() => {
        return this.executarConsulta<T>(query, parametros);
      },
    };
  }

  private executarConsulta<T>(
    query: string,
    parametros: unknown[]
  ): Promise<{ results: T[] }> {
    if (this.mensagemFalhaAtiva !== null) {
      return Promise.reject(new Error(this.mensagemFalhaAtiva));
    }

    const sqlNormalizado = query.replace(/\s+/g, " ").trim().toLowerCase();
    const uidParametro = String(parametros[0] ?? "");

    if (sqlNormalizado.includes("from catalogo_croquis")) {
      const croqui = this.croquis.get(uidParametro);
      if (!croqui) {
        return Promise.resolve({ results: [] });
      }
      const linha = {
        croqui_uid: croqui.croqui_uid,
        id_slug: croqui.id_slug,
        nome: croqui.nome.trim(),
        cidade: croqui.cidade ? croqui.cidade.trim() : null,
        estado: croqui.estado ? croqui.estado.trim() : null,
      } as unknown as T;
      return Promise.resolve({ results: [linha] });
    }

    if (sqlNormalizado.includes("from catalogo_aresta")) {
      const entidade = this.entidades.get(uidParametro);
      if (
        !entidade ||
        !["grupo", "setor", "escalada"].includes(entidade.tipo)
      ) {
        return Promise.resolve({ results: [] });
      }
      const croqui = this.croquis.get(entidade.croqui_uid);
      if (!croqui) {
        return Promise.resolve({ results: [] });
      }
      const setor = entidade.setor_uid
        ? this.entidades.get(entidade.setor_uid)
        : undefined;
      const grupo = entidade.grupo_uid
        ? this.entidades.get(entidade.grupo_uid)
        : undefined;

      const linha = {
        uid: entidade.uid,
        tipo: entidade.tipo,
        nome: entidade.nome.trim(),
        croqui_uid: croqui.croqui_uid,
        id_slug: croqui.id_slug,
        croqui_nome: croqui.nome.trim(),
        cidade: croqui.cidade ? croqui.cidade.trim() : null,
        estado: croqui.estado ? croqui.estado.trim() : null,
        escalada_grau: entidade.escalada_grau
          ? entidade.escalada_grau.trim()
          : null,
        escalada_tipo: entidade.escalada_tipo
          ? entidade.escalada_tipo.trim()
          : null,
        setor_nome: setor ? setor.nome.trim() : null,
        grupo_nome: grupo ? grupo.nome.trim() : null,
      } as unknown as T;
      return Promise.resolve({ results: [linha] });
    }

    return Promise.resolve({ results: [] });
  }
}
