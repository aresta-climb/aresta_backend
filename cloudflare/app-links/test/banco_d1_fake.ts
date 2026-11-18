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
 * Tipo de entrada flexível para inserção de croquis no Fake em memória,
 * assumindo `null` quando os campos geográficos opcionais não forem informados.
 */
export type EntradaCroquiFake = Omit<
  LinhaCatalogoCroquis,
  "latitude_e7" | "longitude_e7" | "url_google_maps"
> &
  Partial<
    Pick<
      LinhaCatalogoCroquis,
      "latitude_e7" | "longitude_e7" | "url_google_maps"
    >
  >;

/**
 * Fake determinístico em memória do banco Cloudflare D1 (`aresta-catalogo`).
 *
 * Mantém as tabelas `catalogo_croquis` e `catalogo_aresta` em memória,
 * resolvendo consultas parametrizadas de croquis, entidades, subentidades,
 * agregações de vitrine e listagens para busca/sitemap, além de simular falhas de I/O.
 */
export class BancoD1Fake implements BancoD1 {
  private readonly croquis = new Map<string, LinhaCatalogoCroquis>();
  private readonly entidades = new Map<string, LinhaCatalogoAresta>();
  private mensagemFalhaAtiva: string | null = null;
  public totalConsultasExecutadas = 0;

  configurarFalha(mensagemErro: string | null): void {
    this.mensagemFalhaAtiva = mensagemErro;
  }

  inserirCroqui(croqui: EntradaCroquiFake): void {
    this.croquis.set(croqui.croqui_uid, {
      ...croqui,
      latitude_e7: croqui.latitude_e7 ?? null,
      longitude_e7: croqui.longitude_e7 ?? null,
      url_google_maps: croqui.url_google_maps ?? null,
    });
  }

  inserirEntidade(entidade: LinhaCatalogoAresta): void {
    this.entidades.set(entidade.uid, { ...entidade });
  }

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

  private limparTexto(valor: string | null | undefined): string | null {
    const t = valor?.trim() ?? "";
    return t.length > 0 ? t : null;
  }

  private executarConsulta<T>(
    query: string,
    parametros: unknown[]
  ): Promise<{ results: T[] }> {
    this.totalConsultasExecutadas += 1;

    if (this.mensagemFalhaAtiva !== null) {
      return Promise.reject(new Error(this.mensagemFalhaAtiva));
    }

    const sql = query.replace(/\s+/g, " ").trim().toLowerCase();

    // 1. Consulta agregada de croquis da vitrine (/croquis)
    if (sql.includes("group by c.croqui_uid")) {
      const lista = Array.from(this.croquis.values()).map((c) => {
        let totalSetores = 0;
        let totalEscaladas = 0;
        for (const e of this.entidades.values()) {
          if (e.croqui_uid === c.croqui_uid) {
            if (e.tipo === "setor") totalSetores += 1;
            if (e.tipo === "escalada") totalEscaladas += 1;
          }
        }
        return {
          croqui_uid: c.croqui_uid,
          id_slug: c.id_slug,
          nome: c.nome.trim(),
          cidade: this.limparTexto(c.cidade),
          estado: this.limparTexto(c.estado),
          latitude_e7: c.latitude_e7,
          longitude_e7: c.longitude_e7,
          url_google_maps: this.limparTexto(c.url_google_maps),
          total_setores: totalSetores,
          total_escaladas: totalEscaladas,
        };
      });

      lista.sort((a, b) => {
        const ufA = a.estado ?? "ZZ";
        const ufB = b.estado ?? "ZZ";
        if (ufA !== ufB) return ufA.localeCompare(ufB);
        return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
      });

      return Promise.resolve({ results: lista as unknown as T[] });
    }

    // 2. Listagem global para busca.json e sitemap.xml (UNION ALL sem parametros)
    if (sql.includes("union all") && parametros.length === 0) {
      const linhas: Record<string, unknown>[] = [];
      for (const c of this.croquis.values()) {
        linhas.push({
          uid: c.croqui_uid,
          tipo: "croqui",
          nome: c.nome.trim(),
          croqui_nome: c.nome.trim(),
          cidade: this.limparTexto(c.cidade),
          estado: this.limparTexto(c.estado),
          escalada_grau: null,
          escalada_tipo: null,
        });
      }
      for (const e of this.entidades.values()) {
        if (!["grupo", "setor", "escalada"].includes(e.tipo)) continue;
        const c = this.croquis.get(e.croqui_uid);
        if (!c) continue;
        linhas.push({
          uid: e.uid,
          tipo: e.tipo,
          nome: e.nome.trim(),
          croqui_nome: c.nome.trim(),
          cidade: this.limparTexto(c.cidade),
          estado: this.limparTexto(c.estado),
          escalada_grau: this.limparTexto(e.escalada_grau),
          escalada_tipo: this.limparTexto(e.escalada_tipo),
        });
      }
      return Promise.resolve({ results: linhas as unknown as T[] });
    }

    const uidParametro = String(parametros[0] ?? "");

    // 3. Consultas de subentidades filhas (por croqui_uid, grupo_uid ou setor_uid)
    if (
      sql.includes("from catalogo_aresta e") &&
      !sql.includes("union all") &&
      (sql.includes("where e.croqui_uid =") ||
        sql.includes("where e.grupo_uid =") ||
        sql.includes("where e.setor_uid ="))
    ) {
      const filtradas = Array.from(this.entidades.values()).filter((e) => {
        if (sql.includes("where e.croqui_uid =")) {
          return (
            e.croqui_uid === uidParametro &&
            (e.tipo === "grupo" || e.tipo === "setor")
          );
        }
        if (sql.includes("where e.grupo_uid =")) {
          return e.grupo_uid === uidParametro && e.tipo === "setor";
        }
        return e.setor_uid === uidParametro && e.tipo === "escalada";
      });

      filtradas.sort((a, b) => {
        const pesoA = a.tipo === "grupo" ? 0 : 1;
        const pesoB = b.tipo === "grupo" ? 0 : 1;
        if (pesoA !== pesoB) return pesoA - pesoB;
        return a.nome
          .trim()
          .localeCompare(b.nome.trim(), "pt-BR", { sensitivity: "base" });
      });

      const linhasFilhas = filtradas.map((e) => {
        const setor = e.setor_uid ? this.entidades.get(e.setor_uid) : undefined;
        const grupo = e.grupo_uid ? this.entidades.get(e.grupo_uid) : undefined;
        return {
          uid: e.uid,
          tipo: e.tipo,
          nome: e.nome.trim(),
          escalada_grau: this.limparTexto(e.escalada_grau),
          escalada_tipo: this.limparTexto(e.escalada_tipo),
          setor_uid: e.setor_uid,
          setor_nome: setor ? setor.nome.trim() : null,
          grupo_uid: e.grupo_uid,
          grupo_nome: grupo ? grupo.nome.trim() : null,
        };
      });
      return Promise.resolve({ results: linhasFilhas as unknown as T[] });
    }

    const ehUnionAll = sql.includes("union all");

    // 4. Consulta individual em catalogo_croquis ou unificada por UID
    if (sql.includes("from catalogo_croquis")) {
      const croqui = this.croquis.get(uidParametro);
      if (croqui) {
        const nomeLimpo = croqui.nome.trim();
        const linha = (ehUnionAll
          ? {
              uid: croqui.croqui_uid,
              tipo: "croqui",
              nome: nomeLimpo,
              croqui_uid: croqui.croqui_uid,
              id_slug: croqui.id_slug,
              croqui_nome: nomeLimpo,
              cidade: this.limparTexto(croqui.cidade),
              estado: this.limparTexto(croqui.estado),
              escalada_grau: null,
              escalada_tipo: null,
              setor_uid: null,
              setor_nome: null,
              grupo_uid: null,
              grupo_nome: null,
              latitude_e7: croqui.latitude_e7,
              longitude_e7: croqui.longitude_e7,
              url_google_maps: this.limparTexto(croqui.url_google_maps),
            }
          : {
              croqui_uid: croqui.croqui_uid,
              id_slug: croqui.id_slug,
              nome: nomeLimpo,
              cidade: this.limparTexto(croqui.cidade),
              estado: this.limparTexto(croqui.estado),
              latitude_e7: croqui.latitude_e7,
              longitude_e7: croqui.longitude_e7,
              url_google_maps: this.limparTexto(croqui.url_google_maps),
            }) as unknown as T;
        return Promise.resolve({ results: [linha] });
      }
      if (!ehUnionAll) {
        return Promise.resolve({ results: [] });
      }
    }

    // 5. Consulta individual em catalogo_aresta
    if (sql.includes("from catalogo_aresta")) {
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
        cidade: this.limparTexto(croqui.cidade),
        estado: this.limparTexto(croqui.estado),
        escalada_grau: this.limparTexto(entidade.escalada_grau),
        escalada_tipo: this.limparTexto(entidade.escalada_tipo),
        setor_uid: entidade.setor_uid,
        setor_nome: setor ? setor.nome.trim() : null,
        grupo_uid: entidade.grupo_uid,
        grupo_nome: grupo ? grupo.nome.trim() : null,
        latitude_e7: croqui.latitude_e7,
        longitude_e7: croqui.longitude_e7,
        url_google_maps: this.limparTexto(croqui.url_google_maps),
      } as unknown as T;
      return Promise.resolve({ results: [linha] });
    }

    return Promise.resolve({ results: [] });
  }
}
