// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

/**
 * Representa o contexto de execução assíncrona de Cloudflare Workers ou Supabase Edge Functions (`ctx.waitUntil`).
 */
export interface ContextoExecucaoAssincrona {
  waitUntil(promessa: Promise<unknown>): void;
}

/**
 * Parâmetros de contexto para relato de exceções ao Sentry.
 */
export interface OpcoesRelatoSentry {
  dsn?: string;
  servico: string;
  ambiente?: string;
  requisicao?: Request;
  tags?: Record<string, string>;
  extras?: Record<string, unknown>;
  contextoExecucao?: ContextoExecucaoAssincrona;
  fetchFn?: typeof fetch;
}

/**
 * Estrutura de um evento capturado para inspeção determinística em testes.
 */
export interface EventoCapturadoSentry {
  erro: unknown;
  mensagem: string;
  pilha?: string;
  servico: string;
  ambiente: string;
  urlRequisicao?: string;
  metodoRequisicao?: string;
  cabecalhosSanitizados?: Record<string, string>;
  tags: Record<string, string>;
  extras: Record<string, unknown>;
}

/**
 * Contrato comum para relatores de erro do Sentry (produção e fake determinístico).
 */
export interface InterfaceRelatorSentry {
  relatarErro(erro: unknown, opcoes: OpcoesRelatoSentry): Promise<boolean>;
}

const CABECALHOS_SENSIVEIS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "cf-access-client-secret",
  "x-supabase-auth",
]);

/**
 * Remove cabeçalhos sensíveis de autenticação e sessão antes de enviá-los à telemetria.
 */
export function sanitizarCabecalhos(
  headers: Headers,
): Record<string, string> {
  const resultado: Record<string, string> = {};
  headers.forEach((valor, chave) => {
    const chaveMinuscula = chave.toLowerCase();
    if (CABECALHOS_SENSIVEIS.has(chaveMinuscula)) {
      resultado[chaveMinuscula] = "[REDACTED]";
    } else {
      resultado[chaveMinuscula] = valor;
    }
  });
  return resultado;
}

/**
 * Biblioteca Fake determinística em memória para testar a fronteira de telemetria Sentry
 * em Workers e Edge Functions sem realizar chamadas externas de rede.
 */
export class RelatorSentryFake implements InterfaceRelatorSentry {
  public readonly eventos: EventoCapturadoSentry[] = [];
  public simularFalhaRede = false;

  /**
   * Registra o erro em memória respeitando as mesmas regras de DSN, sanitização e `waitUntil` do cliente real.
   */
  public relatarErro(
    erro: unknown,
    opcoes: OpcoesRelatoSentry,
  ): Promise<boolean> {
    const dsn = opcoes.dsn?.trim() ?? "";
    if (!dsn) {
      return Promise.resolve(false);
    }

    const tarefa = Promise.resolve().then(() => {
      if (this.simularFalhaRede) {
        return false;
      }

      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const pilha = erro instanceof Error ? erro.stack : undefined;

      const evento: EventoCapturadoSentry = {
        erro,
        mensagem,
        pilha,
        servico: opcoes.servico,
        ambiente: opcoes.ambiente ?? "producao",
        urlRequisicao: opcoes.requisicao?.url,
        metodoRequisicao: opcoes.requisicao?.method,
        cabecalhosSanitizados: opcoes.requisicao
          ? sanitizarCabecalhos(opcoes.requisicao.headers)
          : undefined,
        tags: { ...(opcoes.tags ?? {}) },
        extras: { ...(opcoes.extras ?? {}) },
      };

      this.eventos.push(evento);
      return true;
    });

    if (opcoes.contextoExecucao) {
      opcoes.contextoExecucao.waitUntil(tarefa);
    }

    return tarefa;
  }

  /**
   * Limpa os eventos registrados e restaura a configuração padrão do Fake.
   */
  public limpar(): void {
    this.eventos.length = 0;
    this.simularFalhaRede = false;
  }
}
