// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  LinhaChavesUsuarioFixalog,
  LinhaLaudosFixalog,
  LinhaVersoesLaudoFixalog,
} from "../../../../aresta_api/sql/generated/ts/fixalog_d1_sql.ts";

/**
 * Statement preparado do Cloudflare D1 utilizado pelo Worker do Fixalog.
 */
export interface DeclaracaoPreparadaD1Fixalog {
  bind(...valores: unknown[]): DeclaracaoPreparadaD1Fixalog;
  run(): Promise<{ success: boolean }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/**
 * Interface de banco Cloudflare D1 utilizado pelo Worker do Fixalog.
 */
export interface BancoD1Fixalog {
  prepare(query: string): DeclaracaoPreparadaD1Fixalog;
}

/**
 * Opções de intervalo parcial de bytes para leitura no Cloudflare R2.
 */
export interface OpcoesRangeR2 {
  range?: {
    offset: number;
    length: number;
  };
}

/**
 * Objeto retornado pelo Cloudflare R2.
 */
export interface ObjetoR2Fixalog {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Resultado de listagem de objetos no Cloudflare R2.
 */
export interface ListaObjetosR2Fixalog {
  objects: Array<{ key: string; size: number }>;
}

/**
 * Interface de bucket Cloudflare R2 (`fixalog-laudos`).
 */
export interface BucketR2Fixalog {
  put(chave: string, valor: Uint8Array): Promise<void>;
  get(chave: string, opcoes?: OpcoesRangeR2): Promise<ObjetoR2Fixalog | null>;
  delete(chave: string | string[]): Promise<void>;
  list(opcoes?: { prefix?: string }): Promise<ListaObjetosR2Fixalog>;
}

/**
 * Interface do Cloudflare Workers AI (`env.AI`).
 */
export interface WorkersAiFixalog {
  run(
    modelo: string,
    entrada: Record<string, unknown>,
  ): Promise<{ response?: string; description?: string }>;
}

/**
 * Contexto de execução assíncrona do Cloudflare Worker (`ctx.waitUntil`).
 */
export interface ContextoExecucaoFixalog {
  waitUntil(promessa: Promise<unknown>): void;
}

/**
 * Bindings e dependências de ambiente do Worker `fixalog`.
 */
export interface AmbienteFixalog {
  DB?: BancoD1Fixalog;
  LAUDOS_BUCKET?: BucketR2Fixalog;
  AI?: WorkersAiFixalog;
  ALERTA_URL?: string;
  SENTRY_DSN?: string;
  fetchExterno?: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Fake determinístico em memória do banco D1 compartilhado `aresta-catalogo`
 * para as tabelas `chaves_usuario_fixalog`, `laudos_fixalog` e `versoes_laudo_fixalog`.
 */
export class BancoD1FixalogFake implements BancoD1Fixalog {
  readonly chaves = new Map<string, LinhaChavesUsuarioFixalog>();
  readonly laudos = new Map<string, LinhaLaudosFixalog>();
  readonly versoes = new Map<string, LinhaVersoesLaudoFixalog>();
  deveFalhar = false;

  private static chaveVersao(idSessao: string, versao: number): string {
    return `${idSessao}#v${versao}`;
  }

  prepare(query: string): DeclaracaoPreparadaD1Fixalog {
    const sqlNormalizado = query.replace(/\s+/g, " ").trim();
    let params: unknown[] = [];

    const executarMutacao = (): { success: boolean } => {
      if (this.deveFalhar) {
        throw new Error("Falha simulada no D1.");
      }
      const sqlUpper = sqlNormalizado.toUpperCase();

      if (sqlUpper.includes("INSERT") && sqlUpper.includes("CHAVES_USUARIO_FIXALOG")) {
        const linha: LinhaChavesUsuarioFixalog = {
          fingerprint_sha256: String(params[0]),
          user_id: String(params[1]),
          chave_publica_pem: String(params[2]),
          certificado_x509_pem: String(params[3]),
          atestado_oidc_jwt: String(params[4]),
          provedor_oidc: String(params[5]),
          nome_declarado: String(params[6]),
          clube_declarado: params[7] == null ? null : String(params[7]),
          criado_em: String(params[8]),
        };
        this.chaves.set(linha.fingerprint_sha256, linha);
        return { success: true };
      }

      if (sqlUpper.includes("INSERT") && sqlUpper.includes("LAUDOS_FIXALOG")) {
        const linha: LinhaLaudosFixalog = {
          id_sessao: String(params[0]),
          user_id: String(params[1]),
          categoria: String(params[2]),
          id_protocolo: String(params[3]),
          titulo: String(params[4]),
          escalada_uid: params[5] == null ? null : String(params[5]),
          latitude: params[6] == null ? null : Number(params[6]),
          longitude: params[7] == null ? null : Number(params[7]),
          versao_atual: Number(params[8]),
          criado_em: String(params[9]),
          atualizado_em: String(params[10]),
        };
        this.laudos.set(linha.id_sessao, linha);
        return { success: true };
      }

      if (sqlUpper.includes("UPDATE LAUDOS_FIXALOG")) {
        const idSessao = String(params[params.length - 1]);
        const existente = this.laudos.get(idSessao);
        if (existente) {
          existente.titulo = String(params[0]);
          existente.escalada_uid = params[1] == null ? null : String(params[1]);
          existente.latitude = params[2] == null ? null : Number(params[2]);
          existente.longitude = params[3] == null ? null : Number(params[3]);
          existente.versao_atual = Number(params[4]);
          existente.atualizado_em = String(params[5]);
        }
        return { success: true };
      }

      if (sqlUpper.includes("INSERT") && sqlUpper.includes("VERSOES_LAUDO_FIXALOG")) {
        const linha: LinhaVersoesLaudoFixalog = {
          id_sessao: String(params[0]),
          versao: Number(params[1]),
          r2_key: String(params[2]),
          tamanho_bytes: Number(params[3]),
          hash_epub_sha256: String(params[4]),
          fingerprint_chave: String(params[5]),
          nome_mantenedor: String(params[6]),
          clube_mantenedor: params[7] == null ? null : String(params[7]),
          indices_zip_json: String(params[8]),
          materiais_referenciados_json: String(params[9]),
          status_moderacao: String(params[10]),
          motivo_moderacao: params[11] == null ? null : String(params[11]),
          criado_em: String(params[12]),
        };
        this.versoes.set(
          BancoD1FixalogFake.chaveVersao(linha.id_sessao, linha.versao),
          linha,
        );
        return { success: true };
      }

      if (sqlUpper.includes("UPDATE VERSOES_LAUDO_FIXALOG SET STATUS_MODERACAO")) {
        const novoStatus = String(params[0]);
        const motivo = params[1] == null ? null : String(params[1]);
        const idSessao = String(params[2]);
        const versao = Number(params[3]);
        const existente = this.versoes.get(
          BancoD1FixalogFake.chaveVersao(idSessao, versao),
        );
        if (existente) {
          existente.status_moderacao = novoStatus;
          existente.motivo_moderacao = motivo;
        }
        return { success: true };
      }

      return { success: true };
    };

    const executarSelecao = <T>(): T[] => {
      if (this.deveFalhar) {
        throw new Error("Falha simulada no D1.");
      }
      const sqlUpper = sqlNormalizado.toUpperCase();

      if (sqlUpper.includes("FROM CHAVES_USUARIO_FIXALOG WHERE FINGERPRINT_SHA256")) {
        const fp = String(params[0]);
        const encontrado = this.chaves.get(fp);
        return (encontrado ? [encontrado] : []) as unknown as T[];
      }

      if (sqlUpper.includes("COUNT(DISTINCT ID_SESSAO)") && sqlUpper.includes("VERSOES_LAUDO_FIXALOG")) {
        const fp = String(params[0]);
        const sessoesDistintas = new Set<string>();
        for (const v of this.versoes.values()) {
          if (v.fingerprint_chave === fp) {
            sessoesDistintas.add(v.id_sessao);
          }
        }
        return [{ total: sessoesDistintas.size }] as unknown as T[];
      }

      if (sqlUpper.includes("FROM LAUDOS_FIXALOG WHERE ID_SESSAO")) {
        const id = String(params[0]);
        const encontrado = this.laudos.get(id);
        return (encontrado ? [encontrado] : []) as unknown as T[];
      }

      if (sqlUpper.includes("FROM LAUDOS_FIXALOG WHERE USER_ID")) {
        const userId = String(params[0]);
        const lista = Array.from(this.laudos.values()).filter(
          (l) => l.user_id === userId,
        );
        return lista as unknown as T[];
      }

      if (
        sqlUpper.includes(
          "FROM VERSOES_LAUDO_FIXALOG WHERE ID_SESSAO = ? AND HASH_EPUB_SHA256 = ?",
        )
      ) {
        const id = String(params[0]);
        const hash = String(params[1]).toLowerCase();
        const encontrado = Array.from(this.versoes.values()).find(
          (v) =>
            v.id_sessao === id && v.hash_epub_sha256.toLowerCase() === hash,
        );
        return (encontrado ? [encontrado] : []) as unknown as T[];
      }

      if (
        sqlUpper.includes("FROM VERSOES_LAUDO_FIXALOG WHERE ID_SESSAO = ? AND VERSAO = ?")
      ) {
        const id = String(params[0]);
        const versao = Number(params[1]);
        const encontrado = this.versoes.get(
          BancoD1FixalogFake.chaveVersao(id, versao),
        );
        return (encontrado ? [encontrado] : []) as unknown as T[];
      }

      if (sqlUpper.includes("FROM VERSOES_LAUDO_FIXALOG WHERE ID_SESSAO = ?")) {
        const id = String(params[0]);
        const lista = Array.from(this.versoes.values())
          .filter((v) => v.id_sessao === id)
          .sort((a, b) => a.versao - b.versao);
        return lista as unknown as T[];
      }

      return [];
    };

    const statement: DeclaracaoPreparadaD1Fixalog = {
      bind(...valores: unknown[]) {
        params = valores;
        return statement;
      },
      async run() {
        return executarMutacao();
      },
      async first<T = Record<string, unknown>>() {
        const itens = executarSelecao<T>();
        return itens.length > 0 ? itens[0] : null;
      },
      async all<T = Record<string, unknown>>() {
        return { results: executarSelecao<T>() };
      },
    };
    return statement;
  }
}

/**
 * Fake determinístico em memória do Cloudflare R2 (`fixalog-laudos`) com
 * suporte real a fatiamento parcial de bytes (`range: { offset, length }`),
 * listagem por prefixo e exclusão de objetos temporários de staging.
 */
export class BucketR2FixalogFake implements BucketR2Fixalog {
  readonly objetos = new Map<string, Uint8Array>();

  async put(chave: string, valor: Uint8Array): Promise<void> {
    this.objetos.set(chave, new Uint8Array(valor));
  }

  async get(
    chave: string,
    opcoes?: OpcoesRangeR2,
  ): Promise<ObjetoR2Fixalog | null> {
    const completo = this.objetos.get(chave);
    if (!completo) {
      return null;
    }

    let fatia = completo;
    if (opcoes?.range) {
      const inicio = Math.max(0, opcoes.range.offset);
      const fim = Math.min(completo.byteLength, inicio + opcoes.range.length);
      fatia = completo.slice(inicio, fim);
    }

    return {
      size: completo.byteLength,
      async arrayBuffer(): Promise<ArrayBuffer> {
        return fatia.buffer.slice(
          fatia.byteOffset,
          fatia.byteOffset + fatia.byteLength,
        ) as ArrayBuffer;
      },
    };
  }

  async delete(chave: string | string[]): Promise<void> {
    const lista = Array.isArray(chave) ? chave : [chave];
    for (const item of lista) {
      this.objetos.delete(item);
    }
  }

  async list(opcoes?: { prefix?: string }): Promise<ListaObjetosR2Fixalog> {
    const prefixo = opcoes?.prefix ?? "";
    const objects: Array<{ key: string; size: number }> = [];
    for (const [key, bytes] of this.objetos.entries()) {
      if (key.startsWith(prefixo)) {
        objects.push({ key, size: bytes.byteLength });
      }
    }
    objects.sort((a, b) => a.key.localeCompare(b.key));
    return { objects };
  }
}

/**
 * Fake determinístico do Cloudflare Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct`).
 */
export class WorkersAiFixalogFake implements WorkersAiFixalog {
  respostasConfiguradas: string[] = [];
  respostaPadrao = "SAFE";
  readonly chamadas: Array<{ modelo: string; entrada: Record<string, unknown> }> = [];

  async run(
    modelo: string,
    entrada: Record<string, unknown>,
  ): Promise<{ response?: string; description?: string }> {
    this.chamadas.push({ modelo, entrada });
    const proxima =
      this.respostasConfiguradas.length > 0
        ? this.respostasConfiguradas.shift()!
        : this.respostaPadrao;
    return { response: proxima };
  }
}

/**
 * Construtor utilitário de ambiente Fake completo para testes do Worker `fixalog`.
 */
export class AmbienteFixalogFake implements AmbienteFixalog {
  readonly DB = new BancoD1FixalogFake();
  readonly LAUDOS_BUCKET = new BucketR2FixalogFake();
  readonly AI = new WorkersAiFixalogFake();
  readonly ALERTA_URL = "https://alertas.arestaclimb.com/api/v1/alertas";
  SENTRY_DSN?: string = "https://chave_publica_fake@o1.ingest.us.sentry.io/4512313384239104";
  readonly requisicoesExternas: Array<{ url: string; init?: RequestInit }> = [];
  readonly promessasBackground: Promise<unknown>[] = [];
  statusSubrequisicaoCsam = 200;

  readonly fetchExterno = async (
    url: string,
    init?: RequestInit,
  ): Promise<Response> => {
    this.requisicoesExternas.push({ url, init });
    if (url.includes("/__csam_scan/")) {
      return new Response(
        this.statusSubrequisicaoCsam === 451 ? "CSAM Blocked" : "OK",
        { status: this.statusSubrequisicaoCsam },
      );
    }
    return new Response(JSON.stringify({ recebido: true }), { status: 200 });
  };

  readonly contexto: ContextoExecucaoFixalog = {
    waitUntil: (promessa: Promise<unknown>) => {
      this.promessasBackground.push(promessa);
    },
  };

  async aguardarTarefasBackground(): Promise<void> {
    while (this.promessasBackground.length > 0) {
      const lote = this.promessasBackground.splice(
        0,
        this.promessasBackground.length,
      );
      await Promise.all(lote);
    }
  }
}
