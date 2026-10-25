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

/**
 * Parâmetros para envio de mensagem em Webhook do Discord.
 */
export interface OpcoesEnvioDiscord {
  urlWebhook: string;
  texto: string;
  avatarUrl?: string;
}

/**
 * Resultado da tentativa de envio via Webhook do Discord.
 */
export interface ResultadoEnvioDiscord {
  sucesso: boolean;
  statusHttp: number;
  urlMensagem?: string;
  erro?: string;
}

/**
 * Contrato de fronteira para o cliente Webhook do Discord.
 */
export interface InterfaceClienteDiscord {
  enviarMensagemWebhook(opcoes: OpcoesEnvioDiscord): Promise<ResultadoEnvioDiscord>;
}

/**
 * Implementação Fake determinística em memória do cliente Discord para testes comportamentais.
 */
export class ClienteDiscordFake implements InterfaceClienteDiscord {
  public readonly mensagensEnviadas: OpcoesEnvioDiscord[] = [];
  public deveFalhar = false;
  public statusFalha = 500;
  public mensagemFalha = "Falha ao enviar webhook ao Discord";

  async enviarMensagemWebhook(opcoes: OpcoesEnvioDiscord): Promise<ResultadoEnvioDiscord> {
    if (this.deveFalhar) {
      return {
        sucesso: false,
        statusHttp: this.statusFalha,
        erro: this.mensagemFalha,
      };
    }

    this.mensagensEnviadas.push({ ...opcoes });

    return {
      sucesso: true,
      statusHttp: 200,
      urlMensagem: `https://discord.com/channels/1000/2000/${3000 + this.mensagensEnviadas.length}`,
    };
  }

  limpar(): void {
    this.mensagensEnviadas.length = 0;
    this.deveFalhar = false;
    this.statusFalha = 500;
    this.mensagemFalha = "Falha ao enviar webhook ao Discord";
  }
}

/**
 * Parâmetros para criação automática de Issue no GitHub via GitHub App (`Aresta Climb Bot`).
 */
export interface OpcoesCriarIssueGithub {
  clientId: string;
  privateKey: string;
  installationId: string;
  repositorio: string;
  titulo: string;
  corpo: string;
  labels: string[];
}

/**
 * Resultado da tentativa de criação de Issue no GitHub.
 */
export interface ResultadoCriarIssueGithub {
  sucesso: boolean;
  statusHttp: number;
  numeroIssue?: number;
  urlIssue?: string;
  erro?: string;
}

/**
 * Parâmetros para sincronização de estado (`open` / `closed`) de Issue no GitHub vinculada a uma Issue do Sentry.
 */
export interface OpcoesSincronizarEstadoIssueGithub {
  clientId: string;
  privateKey: string;
  installationId: string;
  idIssueSentry: string;
  novoEstado: "closed" | "open";
}

/**
 * Resultado da sincronização de estado de Issue no GitHub.
 */
export interface ResultadoSincronizarEstadoIssueGithub {
  sucesso: boolean;
  statusHttp: number;
  issuesAtualizadas: number;
  erro?: string;
}

/**
 * Contrato de fronteira para o cliente do GitHub App (`Aresta Climb Bot`).
 */
export interface InterfaceClienteGithubApp {
  criarIssueEmergencia(opcoes: OpcoesCriarIssueGithub): Promise<ResultadoCriarIssueGithub>;
  sincronizarEstadoIssuePorIdSentry(
    opcoes: OpcoesSincronizarEstadoIssueGithub,
  ): Promise<ResultadoSincronizarEstadoIssueGithub>;
}

/**
 * Implementação Fake determinística em memória do cliente GitHub App para testes comportamentais.
 */
export class ClienteGithubAppFake implements InterfaceClienteGithubApp {
  public readonly issuesCriadas: OpcoesCriarIssueGithub[] = [];
  public readonly sincronizacoesEstado: OpcoesSincronizarEstadoIssueGithub[] = [];
  public deveFalhar = false;
  public statusFalha = 503;
  public mensagemFalha = "API do GitHub indisponível";

  async criarIssueEmergencia(opcoes: OpcoesCriarIssueGithub): Promise<ResultadoCriarIssueGithub> {
    if (this.deveFalhar) {
      return {
        sucesso: false,
        statusHttp: this.statusFalha,
        erro: this.mensagemFalha,
      };
    }

    this.issuesCriadas.push({ ...opcoes, labels: [...opcoes.labels] });
    const numeroIssue = this.issuesCriadas.length;

    return {
      sucesso: true,
      statusHttp: 201,
      numeroIssue,
      urlIssue: `https://github.com/${opcoes.repositorio}/issues/${numeroIssue}`,
    };
  }

  async sincronizarEstadoIssuePorIdSentry(
    opcoes: OpcoesSincronizarEstadoIssueGithub,
  ): Promise<ResultadoSincronizarEstadoIssueGithub> {
    if (this.deveFalhar) {
      return {
        sucesso: false,
        statusHttp: this.statusFalha,
        issuesAtualizadas: 0,
        erro: this.mensagemFalha,
      };
    }

    this.sincronizacoesEstado.push({ ...opcoes });

    return {
      sucesso: true,
      statusHttp: 200,
      issuesAtualizadas: 1,
    };
  }

  limpar(): void {
    this.issuesCriadas.length = 0;
    this.sincronizacoesEstado.length = 0;
    this.deveFalhar = false;
    this.statusFalha = 503;
    this.mensagemFalha = "API do GitHub indisponível";
  }
}

/**
 * Parâmetros para atualização de status (`resolved` / `unresolved`) de uma Issue na API do Sentry.
 */
export interface OpcoesAtualizarStatusSentry {
  tokenApi: string;
  idIssueSentry: string;
  novoStatus: "resolved" | "unresolved";
}

/**
 * Resultado da tentativa de atualização de status de Issue no Sentry.
 */
export interface ResultadoAtualizarStatusSentry {
  sucesso: boolean;
  statusHttp: number;
  erro?: string;
}

/**
 * Contrato de fronteira para o cliente de API do Sentry.
 */
export interface InterfaceClienteSentry {
  atualizarStatusIssue(opcoes: OpcoesAtualizarStatusSentry): Promise<ResultadoAtualizarStatusSentry>;
}

/**
 * Implementação Fake determinística em memória do cliente Sentry para testes comportamentais.
 */
export class ClienteSentryFake implements InterfaceClienteSentry {
  public readonly atualizacoesStatus: OpcoesAtualizarStatusSentry[] = [];
  public deveFalhar = false;
  public statusFalha = 500;
  public mensagemFalha = "API do Sentry indisponível";

  async atualizarStatusIssue(
    opcoes: OpcoesAtualizarStatusSentry,
  ): Promise<ResultadoAtualizarStatusSentry> {
    if (this.deveFalhar) {
      return {
        sucesso: false,
        statusHttp: this.statusFalha,
        erro: this.mensagemFalha,
      };
    }

    this.atualizacoesStatus.push({ ...opcoes });

    return {
      sucesso: true,
      statusHttp: 200,
    };
  }

  limpar(): void {
    this.atualizacoesStatus.length = 0;
    this.deveFalhar = false;
    this.statusFalha = 500;
    this.mensagemFalha = "API do Sentry indisponível";
  }
}

/**
 * Ação clicável (botão) em uma notificação push do `ntfy`.
 */
export interface AcaoNtfy {
  action: "view";
  label: string;
  url: string;
}

/**
 * Parâmetros para envio de notificação push móvel via `ntfy`.
 */
export interface OpcoesEnvioNtfy {
  urlBase: string;
  topico: string;
  titulo: string;
  mensagem: string;
  prioridade: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  iconeUrl?: string;
  urlClique?: string;
  acoes?: AcaoNtfy[];
  tokenApi?: string;
}

/**
 * Resultado da tentativa de envio via `ntfy`.
 */
export interface ResultadoEnvioNtfy {
  sucesso: boolean;
  statusHttp: number;
  erro?: string;
}

/**
 * Contrato de fronteira para o cliente de notificações push `ntfy`.
 */
export interface InterfaceClienteNtfy {
  enviarNotificacaoPush(opcoes: OpcoesEnvioNtfy): Promise<ResultadoEnvioNtfy>;
}

/**
 * Implementação Fake determinística em memória do cliente `ntfy` para testes comportamentais.
 */
export class ClienteNtfyFake implements InterfaceClienteNtfy {
  public readonly notificacoesEnviadas: OpcoesEnvioNtfy[] = [];
  public deveFalhar = false;
  public statusFalha = 502;
  public mensagemFalha = "Servidor ntfy indisponível";

  async enviarNotificacaoPush(opcoes: OpcoesEnvioNtfy): Promise<ResultadoEnvioNtfy> {
    if (this.deveFalhar) {
      return {
        sucesso: false,
        statusHttp: this.statusFalha,
        erro: this.mensagemFalha,
      };
    }

    this.notificacoesEnviadas.push(structuredClone(opcoes));

    return {
      sucesso: true,
      statusHttp: 200,
    };
  }

  limpar(): void {
    this.notificacoesEnviadas.length = 0;
    this.deveFalhar = false;
    this.statusFalha = 502;
    this.mensagemFalha = "Servidor ntfy indisponível";
  }
}

/**
 * Representa uma tarefa pendente de retentativa (criação de Issue no GitHub, envio ao Discord ou envio ao ntfy).
 */
export interface ItemFilaRetentativa {
  id: string;
  tipo: "criar_issue_emergencia" | "enviar_notificacao_discord" | "enviar_notificacao_ntfy";
  criadoEmIso: string;
  tentativas: number;
  dadosIssue?: {
    repositorio: string;
    titulo: string;
    corpo: string;
    labels: string[];
    textoAlertaBase: string;
  };
  dadosDiscord?: {
    categoria: "emergencias" | "bugs";
    texto: string;
  };
  dadosNtfy?: OpcoesEnvioNtfy;
}

/**
 * Contrato de fronteira para a fila persistente de retentativas.
 */
export interface InterfaceFilaRetentativas {
  enfileirar(item: ItemFilaRetentativa): Promise<void>;
  listarPendentes(): Promise<ItemFilaRetentativa[]>;
  remover(id: string): Promise<void>;
}

/**
 * Implementação Fake determinística em memória da fila de retentativas para testes comportamentais.
 */
export class FilaRetentativasFake implements InterfaceFilaRetentativas {
  private readonly itens = new Map<string, ItemFilaRetentativa>();

  async enfileirar(item: ItemFilaRetentativa): Promise<void> {
    this.itens.set(item.id, structuredClone(item));
  }

  async listarPendentes(): Promise<ItemFilaRetentativa[]> {
    return Array.from(this.itens.values()).map((i) => structuredClone(i));
  }

  async remover(id: string): Promise<void> {
    this.itens.delete(id);
  }

  limpar(): void {
    this.itens.clear();
  }
}
