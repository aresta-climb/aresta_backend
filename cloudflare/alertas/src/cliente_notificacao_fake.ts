// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

/**
 * Parâmetros para envio de mensagem em grupo do WhatsApp via WAHA (WhatsApp HTTP API).
 */
export interface OpcoesEnvioWaha {
  urlBase: string;
  chaveApi: string;
  chatId: string;
  texto: string;
  sessao?: string;
}

/**
 * Resultado da tentativa de envio via WAHA.
 */
export interface ResultadoEnvioWaha {
  sucesso: boolean;
  statusHttp: number;
  erro?: string;
}

/**
 * Contrato de fronteira para o cliente WAHA (WhatsApp HTTP API).
 */
export interface InterfaceClienteWaha {
  enviarMensagemGrupo(opcoes: OpcoesEnvioWaha): Promise<ResultadoEnvioWaha>;
}

/**
 * Parâmetros para envio de e-mail de contingência (fallback) via Resend.
 */
export interface OpcoesEnvioResend {
  chaveApi: string;
  remetente: string;
  destinatario: string;
  assunto: string;
  texto: string;
  motivoFalhaWaha: string;
}

/**
 * Resultado da tentativa de envio de e-mail via Resend.
 */
export interface ResultadoEnvioResend {
  sucesso: boolean;
  statusHttp: number;
  idEmail?: string;
}

/**
 * Contrato de fronteira para o cliente de e-mail Resend.
 */
export interface InterfaceClienteResend {
  enviarEmailFallback(opcoes: OpcoesEnvioResend): Promise<ResultadoEnvioResend>;
}

/**
 * Implementação Fake determinística em memória do cliente WAHA para testes comportamentais.
 */
export class ClienteWahaFake implements InterfaceClienteWaha {
  public readonly mensagensEnviadas: Array<Required<OpcoesEnvioWaha>> = [];
  public deveFalhar = false;
  public statusFalha = 502;
  public mensagemFalha = "Gateway WAHA indisponível ou sessão desconectada";

  async enviarMensagemGrupo(opcoes: OpcoesEnvioWaha): Promise<ResultadoEnvioWaha> {
    if (this.deveFalhar) {
      return {
        sucesso: false,
        statusHttp: this.statusFalha,
        erro: this.mensagemFalha,
      };
    }

    this.mensagensEnviadas.push({
      urlBase: opcoes.urlBase,
      chaveApi: opcoes.chaveApi,
      chatId: opcoes.chatId,
      texto: opcoes.texto,
      sessao: opcoes.sessao || "default",
    });

    return {
      sucesso: true,
      statusHttp: 201,
    };
  }

  limpar(): void {
    this.mensagensEnviadas.length = 0;
    this.deveFalhar = false;
    this.statusFalha = 502;
    this.mensagemFalha = "Gateway WAHA indisponível ou sessão desconectada";
  }
}

/**
 * Implementação Fake determinística em memória do cliente Resend para testes comportamentais.
 */
export class ClienteResendFake implements InterfaceClienteResend {
  public readonly emailsEnviados: OpcoesEnvioResend[] = [];
  public deveFalhar = false;
  public statusFalha = 500;

  async enviarEmailFallback(opcoes: OpcoesEnvioResend): Promise<ResultadoEnvioResend> {
    if (this.deveFalhar) {
      return {
        sucesso: false,
        statusHttp: this.statusFalha,
      };
    }

    this.emailsEnviados.push({ ...opcoes });

    return {
      sucesso: true,
      statusHttp: 200,
      idEmail: `email-fake-${this.emailsEnviados.length}`,
    };
  }

  limpar(): void {
    this.emailsEnviados.length = 0;
    this.deveFalhar = false;
    this.statusFalha = 500;
  }
}
