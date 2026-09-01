// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { assertEquals, assertStringIncludes } from "@std/assert";
import { processarRequisicaoGitProxy } from "./git-proxy/index.ts";

function criarPayloadPktLine(comando: string): Uint8Array {
  const tamanhoHex = (comando.length + 4).toString(16).padStart(4, "0");
  return new TextEncoder().encode(`${tamanhoHex}${comando}0000`);
}

Deno.test({
  name: "Integracao Git Proxy: Rejeita requisicao sem cabecalho de autorizacao com 401",
  async fn() {
    const requisicao = new Request("http://localhost/git-proxy/info/refs?service=git-receive-pack", {
      method: "GET",
    });

    const resposta = await processarRequisicaoGitProxy(requisicao);
    assertEquals(resposta.status, 401);
  },
});

Deno.test({
  name: "Integracao Git Proxy: Rejeita push para a branch main com 403 Forbidden",
  async fn() {
    const linhaComando = "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/main\0report-status\n";
    const payload = criarPayloadPktLine(linhaComando);

    const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
      method: "POST",
      headers: {
        "Authorization": "Bearer token-jwt-valido-teste",
        "Content-Type": "application/x-git-receive-pack-request",
      },
      body: payload as unknown as BodyInit,
    });

    const contextoTeste = {
      validarJwt: async (_token: string) => ({
        idUsuario: "user-123",
        email: "escalador@teste.com",
        nomeCompleto: "Escalador Teste",
      }),
    };

    const resposta = await processarRequisicaoGitProxy(requisicao, contextoTeste);
    assertEquals(resposta.status, 403);
    const corpoTexto = await resposta.text();
    assertStringIncludes(corpoTexto, "branch main");
  },
});

Deno.test({
  name: "Integracao Git Proxy: Rejeita criacao de nova branch se ela ja existir no repositorio (409)",
  async fn() {
    const linhaComando = "0000000000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-existente\0report-status\n";
    const payload = criarPayloadPktLine(linhaComando);

    const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
      method: "POST",
      headers: {
        "Authorization": "Bearer token-jwt-valido-teste",
        "Content-Type": "application/x-git-receive-pack-request",
      },
      body: payload as unknown as BodyInit,
    });

    const contextoTeste = {
      validarJwt: async (_token: string) => ({
        idUsuario: "user-123",
        email: "escalador@teste.com",
        nomeCompleto: "Escalador Teste",
      }),
      verificarBranchExisteNoGithub: async (_branch: string) => true,
      obterRegistroBranch: async (_branch: string) => null,
    };

    const resposta = await processarRequisicaoGitProxy(requisicao, contextoTeste);
    assertEquals(resposta.status, 409);
  },
});

Deno.test({
  name: "Integracao Git Proxy: Rejeita atualizacao de branch pertencente a outro autor (403)",
  async fn() {
    const linhaComando = "7c2d1e0000000000000000000000000000000000 8a3f5b0000000000000000000000000000000000 refs/heads/sugestao-lapinha-outro-autor\0report-status\n";
    const payload = criarPayloadPktLine(linhaComando);

    const requisicao = new Request("http://localhost/git-proxy/git-receive-pack", {
      method: "POST",
      headers: {
        "Authorization": "Bearer token-jwt-valido-teste",
        "Content-Type": "application/x-git-receive-pack-request",
      },
      body: payload as unknown as BodyInit,
    });

    const contextoTeste = {
      validarJwt: async (_token: string) => ({
        idUsuario: "user-123",
        email: "invasor@teste.com",
        nomeCompleto: "Invasor Teste",
      }),
      obterRegistroBranch: async (_branch: string) => ({
        id: "1",
        branch_name: "sugestao-lapinha-outro-autor",
        author_id: "user-999",
        author_email: "autor_original@teste.com",
        author_name: "Autor Original",
        pr_number: null,
        pr_url: null,
        status: "aberta",
      }),
    };

    const resposta = await processarRequisicaoGitProxy(requisicao, contextoTeste);
    assertEquals(resposta.status, 403);
    const corpoTexto = await resposta.text();
    assertStringIncludes(corpoTexto, "outro autor");
  },
});
