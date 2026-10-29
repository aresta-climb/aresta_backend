// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { SessaoAtiva, MetadadosEditor, RespostaProxy } from "./tipos.ts";

const CARACTERES_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

export class GerenciadorSessao {
  private sessoes = new Map<string, SessaoAtiva>();
  private readonly tempoLimiteInatividadeMs = 30 * 60 * 1000; // 30 minutos
  public aoEncerrarSessao?: (sessao: SessaoAtiva, motivo: string, duracaoSegundos: number) => void;

  public normalizarCodigo(codigo: string): string {
    return codigo.replace(/[\s\-]+/g, "").toLowerCase();
  }

  public formatarCodigo(codigo: string): string {
    const norm = this.normalizarCodigo(codigo);
    if (norm.length >= 8) {
      return `${norm.substring(0, 4)}-${norm.substring(4)}`;
    }
    return norm;
  }

  public extrairNumeroPullRequest(codigo: string): number | null {
    const norm = this.normalizarCodigo(codigo);
    if (norm.length < 8) return null;
    const match = /^pr0*([1-9]\d*)$/.exec(norm);
    if (!match) return null;
    return parseInt(match[1], 10);
  }

  public ehCodigoPullRequest(codigo: string): boolean {
    return this.extrairNumeroPullRequest(codigo) !== null;
  }

  /**
   * Gera um código de sessão Base36 aleatório seguro e garantidamente único,
   * evitando o prefixo reservado "pr" de Pull Requests.
   */
  public gerarCodigoUnico(tamanho = 8): string {
    let codigo = "";
    let tentativas = 0;
    do {
      const bytes = new Uint8Array(tamanho);
      crypto.getRandomValues(bytes);
      codigo = Array.from(bytes)
        .map((b) => CARACTERES_BASE36[b % CARACTERES_BASE36.length])
        .join("");
      tentativas++;
    } while ((this.sessoes.has(codigo) || codigo.startsWith("pr")) && tentativas < 100);

    return codigo;
  }

  /**
   * Cria e reserva uma sessão autorizada no servidor.
   */
  public criarSessao(
    usuarioId: string,
    usuarioEmail: string,
    metadados: MetadadosEditor = {},
    ipOrigem?: string,
    userAgent?: string,
    idAuditoria?: string,
    codigoCustom?: string,
  ): SessaoAtiva {
    const codigo = codigoCustom ? this.normalizarCodigo(codigoCustom) : this.gerarCodigoUnico();
    const agora = Date.now();

    // Se o mesmo usuário já possui uma sessão ativa, encerra a anterior
    if (usuarioId) {
      for (const [cod, s] of Array.from(this.sessoes.entries())) {
        if (s.usuarioId === usuarioId) {
          this.removerSessao(cod, 1000, "Nova sessão iniciada pelo mesmo usuário");
        }
      }
    }

    if (this.sessoes.has(codigo)) {
      this.removerSessao(codigo, 1000, "Nova sessão sobrepôs a anterior");
    }

    const sessao: SessaoAtiva = {
      codigo,
      metadados,
      ouvintes: new Set(),
      criadoEm: agora,
      ultimoAcessoEm: agora,
      usuarioId,
      usuarioEmail,
      idAuditoria,
      ipOrigem,
      userAgent,
      requisicoesPendentes: new Map(),
    };

    this.sessoes.set(codigo, sessao);
    return sessao;
  }

  /**
   * Vincula ou registra a conexão WebSocket do editor à sessão.
   */
  public registrarSessao(codigo: string, socketEditor: WebSocket, metadados: MetadadosEditor = {}): SessaoAtiva {
    const normalizado = this.normalizarCodigo(codigo);
    let sessao = this.sessoes.get(normalizado);

    if (sessao) {
      sessao.socketEditor = socketEditor;
      sessao.metadados = { ...sessao.metadados, ...metadados };
      sessao.ultimoAcessoEm = Date.now();
    } else {
      sessao = {
        codigo: normalizado,
        socketEditor,
        metadados,
        ouvintes: new Set(),
        criadoEm: Date.now(),
        ultimoAcessoEm: Date.now(),
        requisicoesPendentes: new Map(),
      };
      this.sessoes.set(normalizado, sessao);
    }

    return sessao;
  }

  public obterSessao(codigo: string): SessaoAtiva | undefined {
    const normalizado = this.normalizarCodigo(codigo);
    const sessao = this.sessoes.get(normalizado);
    if (!sessao) return undefined;

    // Verifica expiração por inatividade
    if (Date.now() - sessao.ultimoAcessoEm > this.tempoLimiteInatividadeMs) {
      this.removerSessao(normalizado, 1000, "Sessão expirada por inatividade");
      return undefined;
    }

    sessao.ultimoAcessoEm = Date.now();
    return sessao;
  }

  public desconectarSocketEditor(codigo: string, toleranciaMs = 600000): void {
    const normalizado = this.normalizarCodigo(codigo);
    const sessao = this.sessoes.get(normalizado);
    if (!sessao) return;

    sessao.socketEditor = undefined;
    sessao.ultimoAcessoEm = Date.now();

    // Se não houver reconexão durante o período de tolerância, remove a sessão
    setTimeout(() => {
      const s = this.sessoes.get(normalizado);
      if (s && !s.socketEditor) {
        this.removerSessao(normalizado, 1000, "Editor não reconectou no tempo limite");
      }
    }, toleranciaMs);
  }

  public adicionarOuvinte(codigo: string, socketOuvinte: WebSocket): boolean {
    const sessao = this.obterSessao(codigo);
    if (!sessao) return false;

    sessao.ouvintes.add(socketOuvinte);
    return true;
  }

  public removerOuvinte(codigo: string, socketOuvinte: WebSocket): void {
    const sessao = this.sessoes.get(this.normalizarCodigo(codigo));
    if (sessao) {
      sessao.ouvintes.delete(socketOuvinte);
    }
  }

  public emitirEventoParaOuvintes(codigo: string, eventoPayload: any): void {
    const sessao = this.obterSessao(codigo);
    if (!sessao) return;

    const mensagem = JSON.stringify(eventoPayload);
    for (const ouvinte of sessao.ouvintes) {
      try {
        ouvinte.send(mensagem);
      } catch {
        sessao.ouvintes.delete(ouvinte);
      }
    }
  }

  public registrarRespostaProxy(codigo: string, resposta: RespostaProxy): boolean {
    const sessao = this.obterSessao(codigo);
    if (!sessao) return false;

    const callback = sessao.requisicoesPendentes.get(resposta.id);
    if (callback) {
      callback(resposta);
      sessao.requisicoesPendentes.delete(resposta.id);
      return true;
    }
    return false;
  }

  public removerSessao(codigo: string, codigoFechamento = 1000, motivo = "Sessão encerrada"): void {
    const normalizado = this.normalizarCodigo(codigo);
    const sessao = this.sessoes.get(normalizado);
    if (!sessao) return;

    const duracaoSegundos = Math.max(0, Math.round((Date.now() - sessao.criadoEm) / 1000));

    if (this.aoEncerrarSessao) {
      try {
        this.aoEncerrarSessao(sessao, motivo, duracaoSegundos);
      } catch (e) {
        console.warn(`Erro no callback aoEncerrarSessao: ${e}`);
      }
    }

    if (sessao.socketEditor) {
      try {
        sessao.socketEditor.close(codigoFechamento, motivo);
      } catch {}
    }

    for (const ouvinte of sessao.ouvintes) {
      try {
        ouvinte.close(codigoFechamento, motivo);
      } catch {}
    }

    for (const [, callback] of sessao.requisicoesPendentes) {
      try {
        callback({
          id: "",
          status: 504,
          cabecalhos: { "content-type": "application/json" },
          corpoBase64: btoa(JSON.stringify({ erro: "Sessão encerrada antes da resposta" })),
        });
      } catch {}
    }
    sessao.requisicoesPendentes.clear();
    this.sessoes.delete(normalizado);
  }

  public quantidadeSessoesAtivas(): number {
    return this.sessoes.size;
  }
}
