// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ContextoExecucaoAssincrona,
  InterfaceRelatorSentry,
  OpcoesRelatoSentry,
  sanitizarCabecalhos,
} from "./relator_sentry_fake.ts";

export type {
  ContextoExecucaoAssincrona,
  InterfaceRelatorSentry,
  OpcoesRelatoSentry,
};
export { sanitizarCabecalhos };

/**
 * Componentes extraídos de um DSN do Sentry.
 */
export interface ConfiguracaoDsnSentry {
  dsn: string;
  chavePublica: string;
  idProjeto: string;
  urlEnvelope: string;
}

/**
 * Frame de pilha de execução no formato esperado pelo protocolo Sentry.
 */
export interface FramePilhaSentry {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}

/**
 * Extrai a chave pública, o ID do projeto e a URL de ingestão (`/api/<id>/envelope/`)
 * a partir de uma string `SENTRY_DSN`. Retorna `null` se o DSN estiver ausente ou malformado.
 */
export function extrairConfiguracaoDsn(
  dsnBruto?: string,
): ConfiguracaoDsnSentry | null {
  const dsn = dsnBruto?.trim() ?? "";
  if (!dsn) return null;

  try {
    const url = new URL(dsn);
    const chavePublica = url.username.trim();
    const partesCaminho = url.pathname.split("/").filter(Boolean);
    const idProjeto = partesCaminho[partesCaminho.length - 1] ?? "";

    if (!chavePublica || !idProjeto) {
      return null;
    }

    const prefixoBase = partesCaminho.slice(0, -1).join("/");
    const caminhoApi = prefixoBase
      ? `/${prefixoBase}/api/${idProjeto}/envelope/`
      : `/api/${idProjeto}/envelope/`;

    return {
      dsn,
      chavePublica,
      idProjeto,
      urlEnvelope: `${url.protocol}//${url.host}${caminhoApi}`,
    };
  } catch {
    return null;
  }
}

const REGEX_FRAME_COM_FUNCAO = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const REGEX_FRAME_DIRETO = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;

/**
 * Converte a string `Error.stack` do V8/Deno em uma lista de frames do Sentry
 * ordenada do frame mais antigo para o frame mais recente.
 */
export function extrairFramesPilha(stack?: string): FramePilhaSentry[] {
  if (!stack) return [];

  const frames: FramePilhaSentry[] = [];
  const linhas = stack.split("\n");

  for (const linha of linhas) {
    const matchComFuncao = REGEX_FRAME_COM_FUNCAO.exec(linha);
    if (matchComFuncao) {
      frames.push({
        function: matchComFuncao[1].trim(),
        filename: matchComFuncao[2].trim(),
        lineno: Number(matchComFuncao[3]),
        colno: Number(matchComFuncao[4]),
        in_app: !matchComFuncao[2].includes("node_modules"),
      });
      continue;
    }

    const matchDireto = REGEX_FRAME_DIRETO.exec(linha);
    if (matchDireto) {
      frames.push({
        function: "<anonymous>",
        filename: matchDireto[1].trim(),
        lineno: Number(matchDireto[2]),
        colno: Number(matchDireto[3]),
        in_app: !matchDireto[1].includes("node_modules"),
      });
    }
  }

  return frames.reverse();
}

/**
 * Implementação de produção do cliente HTTP Sentry Envelope.
 * Não possui dependências externas, sendo compatível com Cloudflare Workers e Supabase Edge Functions.
 */
export class RelatorSentry implements InterfaceRelatorSentry {
  /**
   * Envia o erro ao Sentry via protocolo HTTP Envelope, agendando em `contextoExecucao.waitUntil` quando disponível.
   */
  public relatarErro(
    erro: unknown,
    opcoes: OpcoesRelatoSentry,
  ): Promise<boolean> {
    const configDsn = extrairConfiguracaoDsn(opcoes.dsn);
    if (!configDsn) {
      return Promise.resolve(false);
    }

    const tarefa = this.enviarEnvelope(erro, opcoes, configDsn);
    if (opcoes.contextoExecucao) {
      opcoes.contextoExecucao.waitUntil(tarefa);
    }
    return tarefa;
  }

  private async enviarEnvelope(
    erro: unknown,
    opcoes: OpcoesRelatoSentry,
    configDsn: ConfiguracaoDsnSentry,
  ): Promise<boolean> {
    try {
      const ehInstanciaErro = erro instanceof Error;
      const tipoErro = ehInstanciaErro ? erro.name || "Error" : "Error";
      const mensagemErro = ehInstanciaErro ? erro.message : String(erro);
      const frames = ehInstanciaErro ? extrairFramesPilha(erro.stack) : [];

      const eventId = crypto.randomUUID().replace(/-/g, "");
      const enviadoEm = new Date().toISOString();

      const cabecalhoEnvelope = JSON.stringify({
        event_id: eventId,
        sent_at: enviadoEm,
        dsn: configDsn.dsn,
      });

      const cabecalhoItem = JSON.stringify({
        type: "event",
        content_type: "application/json",
      });

      const payloadEvento: Record<string, unknown> = {
        event_id: eventId,
        timestamp: enviadoEm,
        platform: "javascript",
        level: "error",
        environment: opcoes.ambiente ?? "producao",
        server_name: opcoes.servico,
        tags: {
          servico: opcoes.servico,
          ...(opcoes.tags ?? {}),
        },
        extra: {
          ...(opcoes.extras ?? {}),
        },
        exception: {
          values: [
            {
              type: tipoErro,
              value: mensagemErro,
              stacktrace: frames.length > 0 ? { frames } : undefined,
            },
          ],
        },
      };

      if (opcoes.requisicao) {
        payloadEvento.request = {
          url: opcoes.requisicao.url,
          method: opcoes.requisicao.method,
          headers: sanitizarCabecalhos(opcoes.requisicao.headers),
        };
      }

      const corpoEnvelope = `${cabecalhoEnvelope}\n${cabecalhoItem}\n${
        JSON.stringify(payloadEvento)
      }\n`;

      const funcaoFetch = opcoes.fetchFn ?? fetch;
      const resposta = await funcaoFetch(configDsn.urlEnvelope, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
        },
        body: corpoEnvelope,
      });

      return resposta.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Instância padrão compartilhada para uso direto nos serviços serverless.
 */
export const relatorSentryPadrao = new RelatorSentry();

/**
 * Função utilitária de conveniência que delega ao `relatorSentryPadrao` (ou a um relator injetado).
 */
export function relatarErroSentry(
  erro: unknown,
  opcoes: OpcoesRelatoSentry,
  relator: InterfaceRelatorSentry = relatorSentryPadrao,
): Promise<boolean> {
  return relator.relatarErro(erro, opcoes);
}
