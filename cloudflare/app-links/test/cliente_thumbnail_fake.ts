// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  ClienteThumbnailOg,
  RespostaThumbnailOg,
} from "../src/index.ts";

/**
 * Fake determinístico em memória do cliente de miniaturas OpenGraph (`serving.arestaclimb.com`).
 *
 * Permite cadastrar binários WebP por `id_slug` e simular falhas determinísticas
 * de rede/I/O sem realizar chamadas externas.
 */
export class ClienteThumbnailFake implements ClienteThumbnailOg {
  private readonly thumbnails = new Map<string, Uint8Array>();
  private mensagemFalhaAtiva: string | null = null;
  public readonly requisicoes: Array<{ idSlug: string; metodo: string }> = [];

  /**
   * Configura ou limpa uma falha determinística de rede que será lançada em `obterThumbnail()`.
   */
  configurarFalha(mensagemErro: string | null): void {
    this.mensagemFalhaAtiva = mensagemErro;
  }

  /**
   * Registra uma miniatura WebP em memória associada ao `idSlug` do croqui.
   */
  inserirThumbnail(idSlug: string, conteudo: Uint8Array): void {
    this.thumbnails.set(idSlug, new Uint8Array(conteudo));
  }

  /**
   * Obtém a miniatura em memória para `idSlug`, respeitando o método HTTP (`GET` ou `HEAD`).
   */
  obterThumbnail(
    idSlug: string,
    metodo: string
  ): Promise<RespostaThumbnailOg> {
    this.requisicoes.push({ idSlug, metodo });

    if (this.mensagemFalhaAtiva !== null) {
      return Promise.reject(new Error(this.mensagemFalhaAtiva));
    }

    const bytes = this.thumbnails.get(idSlug);
    if (!bytes) {
      return Promise.resolve({
        status: 404,
        corpo: null,
        contentType: "text/plain; charset=utf-8",
      });
    }

    return Promise.resolve({
      status: 200,
      corpo: metodo === "HEAD" ? null : new Uint8Array(bytes),
      contentType: "image/webp",
    });
  }
}
