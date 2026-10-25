// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

/**
 * Cloudflare Worker: Roteador Central de Alertas Operacionais (`aresta-alertas-worker`)
 *
 * Responsabilidades:
 * 1. Receber e validar criptograficamente (HMAC-SHA256) webhooks do Sentry (`/webhook/sentry`)
 *    e da organização GitHub `aresta-climb` (`/webhook/github`).
 * 2. Classificar a severidade operacional em dois canais/grupos:
 *    - 🚨 Emergências: Crashes fatais (`level: fatal`), Spikes de erro (`metric_alert`),
 *      quedas de Uptime, falhas de GitHub Actions (`workflow_run` com `conclusion === "failure"`
 *      na branch `main` ou tags `v*`) e reabertura de issues com a label `emergencia`.
 *    - 🛠️ Bugs & Feedbacks: Abertura e reabertura de GitHub Issues (sem a label `emergencia`)
 *      e Pull Requests (`opened` e `reopened`).
 * 3. Para toda emergência sem GitHub Issue prévia (Sentry ou falha de GitHub Actions), criar
 *    automaticamente uma Issue com a label `emergencia` usando o GitHub App `Aresta Climb Bot`
 *    e incluir o link na notificação enviada ao canal `#🚨-emergencias` (ignorando o webhook
 *    subsequente `issues.opened` com label `emergencia` para evitar duplicidade).
 * 4. Sincronizar bidirecionalmente o fechamento/resolução e reabertura de issues entre Sentry e GitHub.
 * 5. Entregar notificações via Discord Webhooks (com gist na primeira linha e `@everyone` no rodapé)
 *    e/ou gateway WAHA em standby, acionando fallback por e-mail via Resend e fila de retentativas
 *    no Cloudflare KV + Cron Trigger (`scheduled`).
 */

import {
  AcaoNtfy,
  InterfaceClienteDiscord,
  InterfaceClienteGithubApp,
  InterfaceClienteNtfy,
  InterfaceClienteResend,
  InterfaceClienteSentry,
  InterfaceClienteWaha,
  InterfaceFilaRetentativas,
  ItemFilaRetentativa,
  OpcoesAtualizarStatusSentry,
  OpcoesCriarIssueGithub,
  OpcoesEnvioDiscord,
  OpcoesEnvioNtfy,
  OpcoesEnvioResend,
  OpcoesEnvioWaha,
  OpcoesSincronizarEstadoIssueGithub,
  ResultadoAtualizarStatusSentry,
  ResultadoCriarIssueGithub,
  ResultadoEnvioDiscord,
  ResultadoEnvioNtfy,
  ResultadoEnvioResend,
  ResultadoEnvioWaha,
  ResultadoSincronizarEstadoIssueGithub,
} from "./cliente_notificacao_fake.ts";
import {
  ICONE_EMERGENCIA_WEBP_BASE64,
  ICONE_FEEDBACK_BUGS_WEBP_BASE64,
  URL_ICONE_EMERGENCIA,
  URL_ICONE_FEEDBACK_BUGS,
} from "./icones_alertas_webp.ts";
import * as Sentry from "@sentry/cloudflare";

export interface KvNamespaceCompativel {
  put(chave: string, valor: string, opcoes?: { expirationTtl?: number }): Promise<void>;
  get(chave: string): Promise<string | null>;
  delete(chave: string): Promise<void>;
  list(opcoes?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
}

export interface AmbienteAlertas {
  CANAL_ALERTAS_ATIVO?: "discord" | "whatsapp" | "ambos";
  DISCORD_WEBHOOK_EMERGENCIAS_URL?: string;
  DISCORD_WEBHOOK_BUGS_URL?: string;
  NTFY_BASE_URL?: string;
  NTFY_TOPICO_EMERGENCIAS?: string;
  NTFY_TOPICO_BUGS?: string;
  NTFY_API_TOKEN?: string;
  WAHA_BASE_URL?: string;
  WAHA_API_KEY?: string;
  WAHA_SESSION?: string;
  WHATSAPP_GRUPO_EMERGENCIAS_ID?: string;
  WHATSAPP_GRUPO_BUGS_ID?: string;
  SENTRY_WEBHOOK_SECRET: string;
  SENTRY_API_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET: string;
  ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID?: string;
  ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY?: string;
  ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID?: string;
  RESEND_API_KEY: string;
  EMAIL_REMETENTE_ALERTA?: string;
  EMAIL_DESTINATARIO_FALLBACK?: string;
  SENTRY_DSN?: string;
  FILA_RETENTATIVAS_ALERTAS?: KvNamespaceCompativel;
  clienteDiscord?: InterfaceClienteDiscord;
  clienteNtfy?: InterfaceClienteNtfy;
  clienteWaha?: InterfaceClienteWaha;
  clienteResend?: InterfaceClienteResend;
  clienteGithubApp?: InterfaceClienteGithubApp;
  clienteSentry?: InterfaceClienteSentry;
  filaRetentativas?: InterfaceFilaRetentativas;
}

const CABECALHOS_PADRAO: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, sentry-hook-signature, sentry-hook-resource, x-hub-signature-256, x-github-event",
};

/**
 * Formata o texto para envio ao mural do Discord sem menções sonoras (`@everyone`),
 * preservando o resumo (gist) na primeira linha e respeitando o limite de 2000 caracteres.
 */
export function formatarTextoMuralDiscord(texto: string): string {
  const textoLimpo = texto.replace(/^@everyone\s*/i, "").replace(/\s*@everyone$/i, "").trim();
  const limiteCorpo = 1990;
  return textoLimpo.length > limiteCorpo
    ? `${textoLimpo.slice(0, limiteCorpo - 3)}...`
    : textoLimpo;
}

/**
 * Implementação HTTP real do cliente Discord Incoming Webhook (`POST <webhook_url>`).
 * Opera como mural silencioso (`allowed_mentions: { parse: [] }`) e aplica `avatar_url` por categoria.
 */
export class ClienteDiscordHttp implements InterfaceClienteDiscord {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async enviarMensagemWebhook(opcoes: OpcoesEnvioDiscord): Promise<ResultadoEnvioDiscord> {
    try {
      const conteudoAjustado = formatarTextoMuralDiscord(opcoes.texto);

      const resposta = await this.fetchImpl(opcoes.urlWebhook, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: conteudoAjustado,
          allowed_mentions: { parse: [] },
          ...(opcoes.avatarUrl ? { avatar_url: opcoes.avatarUrl } : {}),
        }),
      });

      if (!resposta.ok) {
        const detalhe = await resposta.text();
        return {
          sucesso: false,
          statusHttp: resposta.status,
          erro: `HTTP ${resposta.status}: ${detalhe}`,
        };
      }

      return {
        sucesso: true,
        statusHttp: resposta.status,
      };
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return {
        sucesso: false,
        statusHttp: 0,
        erro: msg,
      };
    }
  }
}

/**
 * Implementação HTTP real do cliente `ntfy` (`POST <urlBase>`) para notificações push móveis
 * dedicadas com prioridade por categoria, ícone WebP customizado e botões de ação clicáveis.
 */
export class ClienteNtfyHttp implements InterfaceClienteNtfy {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async enviarNotificacaoPush(opcoes: OpcoesEnvioNtfy): Promise<ResultadoEnvioNtfy> {
    const url = opcoes.urlBase.replace(/\/+$/, "");

    try {
      const cabecalhos: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (opcoes.tokenApi) {
        cabecalhos["Authorization"] = `Bearer ${opcoes.tokenApi}`;
      }

      const resposta = await this.fetchImpl(url, {
        method: "POST",
        headers: cabecalhos,
        body: JSON.stringify({
          topic: opcoes.topico,
          title: opcoes.titulo,
          message: opcoes.mensagem,
          priority: opcoes.prioridade,
          tags: opcoes.tags,
          icon: opcoes.iconeUrl,
          ...(opcoes.urlClique ? { click: opcoes.urlClique } : {}),
          ...(opcoes.acoes && opcoes.acoes.length > 0 ? { actions: opcoes.acoes } : {}),
        }),
      });

      if (!resposta.ok) {
        const detalhe = await resposta.text();
        return {
          sucesso: false,
          statusHttp: resposta.status,
          erro: `HTTP ${resposta.status}: ${detalhe}`,
        };
      }

      return {
        sucesso: true,
        statusHttp: resposta.status,
      };
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return {
        sucesso: false,
        statusHttp: 0,
        erro: msg,
      };
    }
  }
}

/**
 * Implementação HTTP real do cliente WAHA (`POST /api/sendText`).
 */
export class ClienteWahaHttp implements InterfaceClienteWaha {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async enviarMensagemGrupo(opcoes: OpcoesEnvioWaha): Promise<ResultadoEnvioWaha> {
    const baseLimpa = opcoes.urlBase.replace(/\/+$/, "");
    const url = `${baseLimpa}/api/sendText`;

    try {
      const resposta = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": opcoes.chaveApi,
        },
        body: JSON.stringify({
          session: opcoes.sessao || "default",
          chatId: opcoes.chatId,
          text: opcoes.texto,
        }),
      });

      if (!resposta.ok) {
        const detalhe = await resposta.text();
        return {
          sucesso: false,
          statusHttp: resposta.status,
          erro: `HTTP ${resposta.status}: ${detalhe}`,
        };
      }

      return {
        sucesso: true,
        statusHttp: resposta.status,
      };
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return {
        sucesso: false,
        statusHttp: 0,
        erro: msg,
      };
    }
  }
}

/**
 * Implementação HTTP real do cliente Resend (`POST https://api.resend.com/emails`).
 */
export class ClienteResendHttp implements InterfaceClienteResend {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async enviarEmailFallback(opcoes: OpcoesEnvioResend): Promise<ResultadoEnvioResend> {
    try {
      const textoCompleto = [
        "⚠️ AVISO DE CONTINGÊNCIA: O canal primário de alertas falhou ao entregar esta notificação.",
        `Motivo da falha: ${opcoes.motivoFalhaWaha}`,
        "------------------------------------------------------------",
        "",
        opcoes.texto,
      ].join("\n");

      const resposta = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${opcoes.chaveApi}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Aresta Alertas <${opcoes.remetente}>`,
          to: [opcoes.destinatario],
          subject: opcoes.assunto,
          text: textoCompleto,
        }),
      });

      return {
        sucesso: resposta.ok,
        statusHttp: resposta.status,
      };
    } catch {
      return {
        sucesso: false,
        statusHttp: 0,
      };
    }
  }
}

/**
 * Implementação HTTP real do cliente da API do Sentry (`PUT https://sentry.io/api/0/issues/{id}/`).
 */
export class ClienteSentryHttp implements InterfaceClienteSentry {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async atualizarStatusIssue(
    opcoes: OpcoesAtualizarStatusSentry,
  ): Promise<ResultadoAtualizarStatusSentry> {
    try {
      const resposta = await this.fetchImpl(
        `https://sentry.io/api/0/issues/${opcoes.idIssueSentry}/`,
        {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${opcoes.tokenApi}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: opcoes.novoStatus,
          }),
        },
      );

      if (!resposta.ok) {
        const detalhe = await resposta.text();
        return {
          sucesso: false,
          statusHttp: resposta.status,
          erro: `HTTP ${resposta.status}: ${detalhe}`,
        };
      }

      return {
        sucesso: true,
        statusHttp: resposta.status,
      };
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return {
        sucesso: false,
        statusHttp: 0,
        erro: msg,
      };
    }
  }
}

/**
 * Codifica um tamanho ASN.1 DER para construção de cabeçalhos PKCS#8.
 */
function codificarTamanhoDer(tamanho: number): number[] {
  if (tamanho < 128) {
    return [tamanho];
  }
  if (tamanho < 256) {
    return [0x81, tamanho];
  }
  return [0x82, (tamanho >> 8) & 0xff, tamanho & 0xff];
}

/**
 * Envolve uma chave privada RSA PKCS#1 (DER) no envelope ASN.1 PKCS#8 exigido pelo `crypto.subtle`.
 */
function envolverPkcs1EmPkcs8(pkcs1Bytes: Uint8Array): Uint8Array {
  const versao = [0x02, 0x01, 0x00];
  const oidRsa = [
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ];
  const cabecalhoOctetString = [0x04, ...codificarTamanhoDer(pkcs1Bytes.length)];
  const tamanhoInterno =
    versao.length + oidRsa.length + cabecalhoOctetString.length + pkcs1Bytes.length;
  const cabecalhoSequencia = [0x30, ...codificarTamanhoDer(tamanhoInterno)];

  const resultado = new Uint8Array(cabecalhoSequencia.length + tamanhoInterno);
  let offset = 0;
  resultado.set(cabecalhoSequencia, offset);
  offset += cabecalhoSequencia.length;
  resultado.set(versao, offset);
  offset += versao.length;
  resultado.set(oidRsa, offset);
  offset += oidRsa.length;
  resultado.set(cabecalhoOctetString, offset);
  offset += cabecalhoOctetString.length;
  resultado.set(pkcs1Bytes, offset);
  return resultado;
}

/**
 * Codifica bytes ou string em Base64URL (RFC 7515) para tokens JWT.
 */
function codificarBase64Url(entrada: Uint8Array | string): string {
  const bytes = typeof entrada === "string" ? new TextEncoder().encode(entrada) : entrada;
  let binario = "";
  for (let i = 0; i < bytes.length; i++) {
    binario += String.fromCharCode(bytes[i]);
  }
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Gera um JWT RS256 assinado para autenticação de GitHub App usando `crypto.subtle`.
 */
export async function gerarJwtGithubApp(
  clientId: string,
  privateKeyPem: string,
): Promise<string> {
  const pemNormalizado = privateKeyPem.replace(/\\n/g, "\n").trim();
  const ehPkcs1 = pemNormalizado.includes("BEGIN RSA PRIVATE KEY");
  const base64Limpo = pemNormalizado
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  const binarioDer = atob(base64Limpo);
  const bytesDer = new Uint8Array(binarioDer.length);
  for (let i = 0; i < binarioDer.length; i++) {
    bytesDer[i] = binarioDer.charCodeAt(i);
  }

  const pkcs8Bytes = ehPkcs1 ? envolverPkcs1EmPkcs8(bytesDer) : bytesDer;

  const chaveCripto = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const agoraSegundos = Math.floor(Date.now() / 1000);
  const cabecalhoJwt = codificarBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpoJwt = codificarBase64Url(
    JSON.stringify({
      iat: agoraSegundos - 60,
      exp: agoraSegundos + 540,
      iss: clientId,
    }),
  );

  const dadosAssinatura = `${cabecalhoJwt}.${corpoJwt}`;
  const assinaturaBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    chaveCripto,
    new TextEncoder().encode(dadosAssinatura),
  );

  return `${dadosAssinatura}.${codificarBase64Url(new Uint8Array(assinaturaBuffer))}`;
}

/**
 * Implementação HTTP real do cliente GitHub App (`Aresta Climb Bot`) para criação e sincronização de Issues.
 */
export class ClienteGithubAppHttp implements InterfaceClienteGithubApp {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  private async obterTokenInstalacao(
    clientId: string,
    privateKey: string,
    installationId: string,
  ): Promise<string> {
    const jwt = await gerarJwtGithubApp(clientId, privateKey);
    const resposta = await this.fetchImpl(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${jwt}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "aresta-alertas-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!resposta.ok) {
      const detalhe = await resposta.text();
      throw new Error(`Falha ao obter installation token (HTTP ${resposta.status}): ${detalhe}`);
    }

    const dados = (await resposta.json()) as { token?: string };
    return dados.token || "";
  }

  async criarIssueEmergencia(opcoes: OpcoesCriarIssueGithub): Promise<ResultadoCriarIssueGithub> {
    try {
      const token = await this.obterTokenInstalacao(
        opcoes.clientId,
        opcoes.privateKey,
        opcoes.installationId,
      );

      const resposta = await this.fetchImpl(
        `https://api.github.com/repos/${opcoes.repositorio}/issues`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "aresta-alertas-worker",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            title: opcoes.titulo,
            body: opcoes.corpo,
            labels: opcoes.labels,
          }),
        },
      );

      if (!resposta.ok) {
        const detalhe = await resposta.text();
        return {
          sucesso: false,
          statusHttp: resposta.status,
          erro: `HTTP ${resposta.status}: ${detalhe}`,
        };
      }

      const dados = (await resposta.json()) as { number?: number; html_url?: string };
      return {
        sucesso: true,
        statusHttp: resposta.status,
        numeroIssue: dados.number,
        urlIssue: dados.html_url,
      };
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return {
        sucesso: false,
        statusHttp: 0,
        erro: msg,
      };
    }
  }

  async sincronizarEstadoIssuePorIdSentry(
    opcoes: OpcoesSincronizarEstadoIssueGithub,
  ): Promise<ResultadoSincronizarEstadoIssueGithub> {
    try {
      const token = await this.obterTokenInstalacao(
        opcoes.clientId,
        opcoes.privateKey,
        opcoes.installationId,
      );

      const estadoBusca = opcoes.novoEstado === "closed" ? "is:open" : "is:closed";
      const query = encodeURIComponent(
        `org:aresta-climb is:issue ${estadoBusca} "sentry.io/issues/${opcoes.idIssueSentry}"`,
      );
      const resBusca = await this.fetchImpl(
        `https://api.github.com/search/issues?q=${query}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "User-Agent": "aresta-alertas-worker",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );

      if (!resBusca.ok) {
        const detalhe = await resBusca.text();
        return {
          sucesso: false,
          statusHttp: resBusca.status,
          issuesAtualizadas: 0,
          erro: `HTTP ${resBusca.status}: ${detalhe}`,
        };
      }

      const dadosBusca = (await resBusca.json()) as {
        items?: Array<{ number: number; repository_url: string }>;
      };
      const itens = Array.isArray(dadosBusca.items) ? dadosBusca.items : [];
      let atualizadas = 0;

      for (const item of itens) {
        const urlIssueApi = `${item.repository_url}/issues/${item.number}`;
        const resPatch = await this.fetchImpl(urlIssueApi, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "aresta-alertas-worker",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            state: opcoes.novoEstado,
          }),
        });
        if (resPatch.ok) {
          atualizadas++;
        }
      }

      return {
        sucesso: true,
        statusHttp: 200,
        issuesAtualizadas: atualizadas,
      };
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      return {
        sucesso: false,
        statusHttp: 0,
        issuesAtualizadas: 0,
        erro: msg,
      };
    }
  }
}

/**
 * Implementação persistente da fila de retentativas utilizando Cloudflare KV (`FILA_RETENTATIVAS_ALERTAS`).
 */
export class FilaRetentativasKv implements InterfaceFilaRetentativas {
  private readonly kv: KvNamespaceCompativel;
  private static readonly PREFIXO = "retentativa:";
  private static readonly TTL_SEGUNDOS = 86400; // 24 horas

  constructor(kv: KvNamespaceCompativel) {
    this.kv = kv;
  }

  async enfileirar(item: ItemFilaRetentativa): Promise<void> {
    await this.kv.put(
      `${FilaRetentativasKv.PREFIXO}${item.id}`,
      JSON.stringify(item),
      { expirationTtl: FilaRetentativasKv.TTL_SEGUNDOS },
    );
  }

  async listarPendentes(): Promise<ItemFilaRetentativa[]> {
    const listagem = await this.kv.list({ prefix: FilaRetentativasKv.PREFIXO });
    const itens: ItemFilaRetentativa[] = [];
    for (const chave of listagem.keys) {
      const bruto = await this.kv.get(chave.name);
      if (bruto) {
        itens.push(JSON.parse(bruto) as ItemFilaRetentativa);
      }
    }
    return itens;
  }

  async remover(id: string): Promise<void> {
    await this.kv.delete(`${FilaRetentativasKv.PREFIXO}${id}`);
  }
}

/**
 * Calcula a assinatura HMAC-SHA256 em hexadecimal para validação de webhooks.
 */
export async function assinarHmacSha256Hex(
  segredo: string,
  corpoBruto: string,
): Promise<string> {
  const codificador = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    codificador.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinaturaBuffer = await crypto.subtle.sign(
    "HMAC",
    chave,
    codificador.encode(corpoBruto),
  );
  return Array.from(new Uint8Array(assinaturaBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compara duas strings em tempo constante para mitigar ataques de timing.
 */
function compararTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

interface NotificacaoClassificada {
  categoria: "emergencias" | "bugs";
  grupoId?: string;
  assuntoFallback: string;
  texto: string;
  urlOrigem?: string;
  urlDiscussaoGithub?: string;
  dadosIssueEmergencia?: {
    repositorio: string;
    titulo: string;
    corpo: string;
    labels: string[];
  };
}

/**
 * Resolve o repositório da organização `aresta-climb` correspondente a um serviço/projeto do Sentry.
 */
function resolverRepositorioPorServicoSentry(servicoTag: string): string {
  const tagNormalizada = servicoTag.toLowerCase();
  if (
    tagNormalizada.includes("backend") ||
    tagNormalizada.includes("worker") ||
    tagNormalizada.includes("alertas")
  ) {
    return "aresta-climb/aresta_backend";
  }
  if (
    tagNormalizada.includes("arestaclimb-com") ||
    tagNormalizada.includes("arestaclimb.com") ||
    tagNormalizada.includes("site")
  ) {
    return "aresta-climb/arestaclimb.com";
  }
  if (tagNormalizada.includes("db")) {
    return "aresta-climb/aresta_db";
  }
  return "aresta-climb/aresta_app";
}

/**
 * Classifica e formata um webhook do Sentry para envio apenas se for Emergência
 * (Crash Fatal, Spike de Metric Alert ou Queda de Uptime).
 */
function classificarWebhookSentry(
  recurso: string,
  payload: Record<string, any>,
  env: AmbienteAlertas,
): NotificacaoClassificada | null {
  const acao = String(payload?.action || "");

  // 1. Spike ou Alerta de Métrica / Uptime
  if (
    recurso === "metric_alert" &&
    (acao === "critical" || acao === "warning" || acao === "triggered")
  ) {
    const dados = payload?.data || {};
    const titulo = dados.description_title || "Alerta Crítico de Métrica / Spike";
    const detalhe = dados.description_text || "Anomalia de volume de erros ou latência detectada.";
    const url = dados.web_url || "https://aresta-climb.sentry.io/alerts/";
    const repositorio = resolverRepositorioPorServicoSentry(titulo);

    return {
      categoria: "emergencias",
      grupoId: env.WHATSAPP_GRUPO_EMERGENCIAS_ID,
      assuntoFallback: `[CONTINGÊNCIA ALERTA] 🚨 ${titulo}`,
      urlOrigem: url,
      texto: [
        `🚨 *[EMERGÊNCIA] ${titulo}*`,
        `• *Detalhe:* ${detalhe}`,
        `• *Painel Sentry:* ${url}`,
      ].join("\n"),
      dadosIssueEmergencia: {
        repositorio,
        titulo: `🚨 [EMERGÊNCIA] ${titulo}`,
        corpo: [
          "### 🚨 Alerta de Métrica / Spike Detectado no Sentry",
          "",
          `- **Alerta:** ${titulo}`,
          `- **Detalhe:** ${detalhe}`,
          `- **Painel Sentry:** ${url}`,
        ].join("\n"),
        labels: ["emergencia"],
      },
    };
  }

  // 2. Crash Fatal ou Evento de Emergência
  const evento = payload?.data?.event;
  if (evento && (evento.level === "fatal" || acao === "triggered")) {
    const titulo = evento.title || "Exceção Fatal em Produção";
    const url = evento.web_url || "https://aresta-climb.sentry.io/issues/";
    const tagsLista: Array<[string, string]> = Array.isArray(evento.tags) ? evento.tags : [];
    const servicoTag = tagsLista.find((t) => t[0] === "service")?.[1] || "ecossistema-aresta";
    const repositorio = resolverRepositorioPorServicoSentry(servicoTag);

    return {
      categoria: "emergencias",
      grupoId: env.WHATSAPP_GRUPO_EMERGENCIAS_ID,
      assuntoFallback: `[CONTINGÊNCIA ALERTA] 🚨 Crash Fatal em ${servicoTag}`,
      urlOrigem: url,
      texto: [
        `🚨 *[EMERGÊNCIA] Crash Fatal em ${servicoTag}: ${titulo}*`,
        `• *Serviço:* \`${servicoTag}\``,
        `• *Erro:* ${titulo}`,
        `• *Investigação Sentry:* ${url}`,
      ].join("\n"),
      dadosIssueEmergencia: {
        repositorio,
        titulo: `🚨 [EMERGÊNCIA] Crash Fatal (${servicoTag}): ${titulo}`,
        corpo: [
          "### 🚨 Crash Fatal Detectado pelo Sentry",
          "",
          `- **Serviço:** \`${servicoTag}\``,
          `- **Erro:** ${titulo}`,
          `- **Investigação Sentry:** ${url}`,
        ].join("\n"),
        labels: ["emergencia"],
      },
    };
  }

  return null;
}

/**
 * Extrai eventual link de Issue do Sentry presente no corpo de uma GitHub Issue.
 */
function extrairLinkSentryDoCorpo(corpoIssue: string): string | null {
  const match = corpoIssue.match(/https:\/\/[a-zA-Z0-9.-]*sentry\.io\/issues\/[0-9]+\/?/);
  return match ? match[0] : null;
}

/**
 * Extrai o ID numérico da Issue do Sentry presente em um link no corpo de uma GitHub Issue.
 */
function extrairIdIssueSentryDoCorpo(corpoIssue: string): string | null {
  const match = corpoIssue.match(/https:\/\/[a-zA-Z0-9.-]*sentry\.io\/issues\/([0-9]+)\/?/);
  return match ? match[1] : null;
}

/**
 * Verifica se a lista de labels de uma GitHub Issue contém a etiqueta `emergencia`.
 */
function possuiLabelEmergencia(labelsBrutas: unknown): boolean {
  if (!Array.isArray(labelsBrutas)) {
    return false;
  }
  return labelsBrutas.some((l: any) => {
    const nome = String(typeof l === "string" ? l : l?.name || "").toLowerCase().trim();
    return nome === "emergencia" || nome === "emergência";
  });
}

/**
 * Classifica e formata um webhook organizacional do GitHub (`workflow_run`, `issues`, `pull_request`).
 */
function classificarWebhookGithub(
  eventoGithub: string,
  payload: Record<string, any>,
  env: AmbienteAlertas,
): NotificacaoClassificada | null {
  const acao = String(payload?.action || "");
  const repositorio = payload?.repository?.full_name || "aresta-climb/aresta_app";

  // 1. Falha de CI / Deploy em main ou tag de release -> Grupo 1 (Emergências) + cria Issue
  if (eventoGithub === "workflow_run" && acao === "completed") {
    const execucao = payload?.workflow_run;
    const conclusao = execucao?.conclusion;
    const branch = String(execucao?.head_branch || "");
    const ehBranchCritica = branch === "main" || branch.startsWith("v");

    if (conclusao === "failure" && ehBranchCritica) {
      const nomeWorkflow = execucao?.name || "Pipeline CI/CD";
      const urlRun = execucao?.html_url || "";
      const commitMsg = String(execucao?.head_commit?.message || "").split("\n")[0];
      const autor = execucao?.head_commit?.author?.name || "N/A";

      return {
        categoria: "emergencias",
        grupoId: env.WHATSAPP_GRUPO_EMERGENCIAS_ID,
        assuntoFallback: `[CONTINGÊNCIA ALERTA] 🚨 Falha de Deploy/CI em ${repositorio}`,
        urlOrigem: urlRun || undefined,
        texto: [
          `🚨 *[EMERGÊNCIA] Falha de Deploy/CI em ${repositorio}: ${nomeWorkflow} (\`${branch}\`)*`,
          `• *Repositório:* \`${repositorio}\``,
          `• *Workflow:* ${nomeWorkflow} (\`${branch}\`)`,
          `• *Commit:* ${commitMsg} (${autor})`,
          `• *Logs da Execução:* ${urlRun}`,
        ].join("\n"),
        dadosIssueEmergencia: {
          repositorio,
          titulo: `🚨 [FALHA DE DEPLOY/CI] ${nomeWorkflow} (${branch})`,
          corpo: [
            "### 🚨 Falha Crítica de Pipeline / Deploy no GitHub Actions",
            "",
            `- **Repositório:** \`${repositorio}\``,
            `- **Workflow:** ${nomeWorkflow} (\`${branch}\`)`,
            `- **Commit:** ${commitMsg} (${autor})`,
            `- **Logs da Execução:** ${urlRun}`,
          ].join("\n"),
          labels: ["emergencia"],
        },
      };
    }
    return null;
  }

  // 2. Issue aberta ou reaberta
  if (eventoGithub === "issues" && (acao === "opened" || acao === "reopened")) {
    const issue = payload?.issue;
    const ehEmergencia = possuiLabelEmergencia(issue?.labels);

    // Se for abertura (`opened`) com label `emergencia`, ignoramos pois a instância do Worker
    // que originou a emergência já criou a issue e está despachando a notificação!
    if (acao === "opened" && ehEmergencia) {
      return null;
    }

    const numero = issue?.number;
    const titulo = issue?.title || "Issue";
    const urlIssue = issue?.html_url || "";
    const corpo = String(issue?.body || "");
    const linkSentry = extrairLinkSentryDoCorpo(corpo);

    // Reabertura de uma issue de emergência -> vai para #🚨-emergencias
    if (acao === "reopened" && ehEmergencia) {
      return {
        categoria: "emergencias",
        grupoId: env.WHATSAPP_GRUPO_EMERGENCIAS_ID,
        assuntoFallback: `[CONTINGÊNCIA ALERTA] 🚨 Emergência Reaberta #${numero} em ${repositorio}`,
        urlDiscussaoGithub: urlIssue || undefined,
        urlOrigem: linkSentry || undefined,
        texto: [
          `🚨 *[EMERGÊNCIA REABERTA #${numero}] ${titulo}*`,
          `• *Repositório:* \`${repositorio}\` (#${numero})`,
          `• *GitHub Issue:* ${urlIssue}`,
        ].join("\n"),
      };
    }

    const cabecalhoGist = acao === "reopened"
      ? `🔄 *[ISSUE REABERTA #${numero}] ${titulo}*`
      : linkSentry
        ? `🐛 *[ERRO SENTRY #${numero}] ${titulo}*`
        : `🛠️ *[NOVA ISSUE #${numero}] ${titulo}*`;

    const linhas = [
      cabecalhoGist,
      `• *Repositório:* \`${repositorio}\` (#${numero})`,
      `• *Título:* ${titulo}`,
      `• *GitHub Issue:* ${urlIssue}`,
    ];

    if (linkSentry) {
      linhas.push(`• *Detalhes no Sentry:* ${linkSentry}`);
    }

    return {
      categoria: "bugs",
      grupoId: env.WHATSAPP_GRUPO_BUGS_ID,
      assuntoFallback: `[CONTINGÊNCIA ALERTA] 🛠️ Issue #${numero} em ${repositorio}`,
      urlDiscussaoGithub: urlIssue || undefined,
      urlOrigem: linkSentry || undefined,
      texto: linhas.join("\n"),
    };
  }

  // 3. Pull Request aberto ou reaberto -> Grupo 2 (Bugs & Feedbacks)
  if (eventoGithub === "pull_request" && (acao === "opened" || acao === "reopened")) {
    const pr = payload?.pull_request;
    const numero = pr?.number;
    const titulo = pr?.title || "Pull Request";
    const urlPr = pr?.html_url || "";
    const autor = pr?.user?.login || "colaborador";
    const prefixoGist = acao === "reopened" ? "🔄 *[PR REABERTO" : "🔀 *[NOVO PR";

    return {
      categoria: "bugs",
      grupoId: env.WHATSAPP_GRUPO_BUGS_ID,
      assuntoFallback: `[CONTINGÊNCIA ALERTA] 🔀 PR #${numero} em ${repositorio}`,
      urlDiscussaoGithub: urlPr || undefined,
      texto: [
        `${prefixoGist} #${numero}] ${titulo}*`,
        `• *Repositório:* \`${repositorio}\` (#${numero})`,
        `• *Título:* ${titulo}`,
        `• *Autor:* \`${autor}\``,
        `• *Revisar PR:* ${urlPr}`,
      ].join("\n"),
    };
  }

  return null;
}

function obterFilaRetentativas(env: AmbienteAlertas): InterfaceFilaRetentativas | null {
  if (env.filaRetentativas) {
    return env.filaRetentativas;
  }
  if (env.FILA_RETENTATIVAS_ALERTAS) {
    return new FilaRetentativasKv(env.FILA_RETENTATIVAS_ALERTAS);
  }
  return null;
}

function obterClienteGithubApp(env: AmbienteAlertas): InterfaceClienteGithubApp | null {
  if (env.clienteGithubApp) {
    return env.clienteGithubApp;
  }
  if (
    env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID &&
    env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY &&
    env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID
  ) {
    return new ClienteGithubAppHttp();
  }
  return null;
}

/**
 * Constrói o payload de notificação push rica do `ntfy` com ícone WebP por categoria,
 * prioridade (`5` para emergências e `3` para bugs) e botões de ação clicáveis.
 */
function construirOpcoesEnvioNtfy(
  notificacao: NotificacaoClassificada,
  topico: string,
  env: AmbienteAlertas,
): OpcoesEnvioNtfy {
  const primeiraLinhaLimpa = notificacao.texto
    .split("\n")[0]
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .trim();
  const corpoDemaisLinhas = notificacao.texto
    .split("\n")
    .slice(1)
    .join("\n")
    .replace(/\*/g, "")
    .trim();

  const ehEmergencia = notificacao.categoria === "emergencias";
  const acoes: AcaoNtfy[] = [];

  if (notificacao.urlDiscussaoGithub) {
    acoes.push({
      action: "view",
      label: "Abrir no GitHub",
      url: notificacao.urlDiscussaoGithub,
    });
  }
  if (
    notificacao.urlOrigem &&
    notificacao.urlOrigem !== notificacao.urlDiscussaoGithub
  ) {
    acoes.push({
      action: "view",
      label: "Ver Origem",
      url: notificacao.urlOrigem,
    });
  }

  return {
    urlBase: env.NTFY_BASE_URL || "https://ntfy.sh",
    topico,
    titulo: `Aresta Climb • ${primeiraLinhaLimpa}`,
    mensagem: corpoDemaisLinhas || primeiraLinhaLimpa,
    prioridade: ehEmergencia ? 5 : 3,
    tags: ehEmergencia
      ? ["rotating_light", "aresta-emergencia"]
      : ["wrench", "aresta-bugs"],
    iconeUrl: ehEmergencia ? URL_ICONE_EMERGENCIA : URL_ICONE_FEEDBACK_BUGS,
    urlClique: notificacao.urlDiscussaoGithub || notificacao.urlOrigem,
    acoes: acoes.length > 0 ? acoes : undefined,
    tokenApi: env.NTFY_API_TOKEN,
  };
}

/**
 * Entrega a notificação para o canal primário configurado (Discord mural, `ntfy` push e/ou WAHA),
 * criando previamente a GitHub Issue de emergência quando aplicável, e aciona
 * fallback via Resend + fila de retentativas em caso de falha.
 */
async function despacharNotificacaoComFallback(
  notificacao: NotificacaoClassificada,
  env: AmbienteAlertas,
): Promise<Response> {
  const fila = obterFilaRetentativas(env);
  const clienteGithub = obterClienteGithubApp(env);

  // 0. Se for uma emergência sem GitHub Issue prévia, cria automaticamente via GitHub App
  if (notificacao.dadosIssueEmergencia && clienteGithub) {
    const dadosIssue = notificacao.dadosIssueEmergencia;
    const resIssue = await clienteGithub.criarIssueEmergencia({
      clientId: env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID || "",
      privateKey: env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY || "",
      installationId: env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID || "",
      repositorio: dadosIssue.repositorio,
      titulo: dadosIssue.titulo,
      corpo: dadosIssue.corpo,
      labels: dadosIssue.labels,
    });

    if (resIssue.sucesso && resIssue.urlIssue) {
      notificacao.urlDiscussaoGithub = resIssue.urlIssue;
      notificacao.texto += `\n• *Discussão GitHub:* ${resIssue.urlIssue} (#${resIssue.numeroIssue})`;
    } else {
      notificacao.texto +=
        `\n• *Discussão GitHub:* ⚠️ Falha ao criar Issue automaticamente (${resIssue.erro || `HTTP ${resIssue.statusHttp}`}). Nova tentativa agendada.`;
      if (fila) {
        await fila.enfileirar({
          id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          tipo: "criar_issue_emergencia",
          criadoEmIso: new Date().toISOString(),
          tentativas: 1,
          dadosIssue: {
            ...dadosIssue,
            textoAlertaBase: notificacao.texto,
          },
        });
      }
    }
  }

  const urlDiscord = notificacao.categoria === "emergencias"
    ? env.DISCORD_WEBHOOK_EMERGENCIAS_URL
    : env.DISCORD_WEBHOOK_BUGS_URL;
  const avatarDiscord = notificacao.categoria === "emergencias"
    ? URL_ICONE_EMERGENCIA
    : URL_ICONE_FEEDBACK_BUGS;

  const topicoNtfy = notificacao.categoria === "emergencias"
    ? env.NTFY_TOPICO_EMERGENCIAS
    : env.NTFY_TOPICO_BUGS;

  const wahaAtivo = Boolean(
    env.WAHA_BASE_URL &&
      env.WAHA_API_KEY &&
      (notificacao.grupoId ||
        (notificacao.categoria === "emergencias"
          ? env.WHATSAPP_GRUPO_EMERGENCIAS_ID
          : env.WHATSAPP_GRUPO_BUGS_ID)),
  );
  const chatIdWaha = notificacao.grupoId || (notificacao.categoria === "emergencias"
    ? env.WHATSAPP_GRUPO_EMERGENCIAS_ID
    : env.WHATSAPP_GRUPO_BUGS_ID);

  const modoCanal = env.CANAL_ALERTAS_ATIVO || "ambos";
  const permiteDiscord = modoCanal === "discord" || modoCanal === "ambos";
  const permiteWaha = modoCanal === "whatsapp" || modoCanal === "ambos";

  const canaisSucesso: string[] = [];
  const motivosFalha: string[] = [];

  // 1. Tenta envio ao mural do Discord se configurado (sem @everyone e com avatar WebP customizado)
  if (permiteDiscord && urlDiscord) {
    const textoDiscord = formatarTextoMuralDiscord(notificacao.texto);
    const clienteDiscord = env.clienteDiscord || new ClienteDiscordHttp();
    const resultadoDiscord = await clienteDiscord.enviarMensagemWebhook({
      urlWebhook: urlDiscord,
      texto: textoDiscord,
      avatarUrl: avatarDiscord,
    });
    if (resultadoDiscord.sucesso) {
      canaisSucesso.push("discord");
    } else {
      motivosFalha.push(
        `Discord falhou: ${resultadoDiscord.erro || `Status HTTP ${resultadoDiscord.statusHttp}`}`,
      );
      if (fila) {
        await fila.enfileirar({
          id: `discord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          tipo: "enviar_notificacao_discord",
          criadoEmIso: new Date().toISOString(),
          tentativas: 1,
          dadosDiscord: {
            categoria: notificacao.categoria,
            texto: textoDiscord,
          },
        });
      }
    }
  }

  // 2. Tenta envio push móvel dedicado via ntfy se configurado
  if (topicoNtfy) {
    const opcoesNtfy = construirOpcoesEnvioNtfy(notificacao, topicoNtfy, env);
    const clienteNtfy = env.clienteNtfy || new ClienteNtfyHttp();
    const resultadoNtfy = await clienteNtfy.enviarNotificacaoPush(opcoesNtfy);
    if (resultadoNtfy.sucesso) {
      canaisSucesso.push("ntfy");
    } else {
      motivosFalha.push(
        `ntfy falhou: ${resultadoNtfy.erro || `Status HTTP ${resultadoNtfy.statusHttp}`}`,
      );
      if (fila) {
        await fila.enfileirar({
          id: `ntfy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          tipo: "enviar_notificacao_ntfy",
          criadoEmIso: new Date().toISOString(),
          tentativas: 1,
          dadosNtfy: opcoesNtfy,
        });
      }
    }
  }

  // 3. Tenta envio ao WAHA se configurado
  if (permiteWaha && wahaAtivo && chatIdWaha) {
    const clienteWaha = env.clienteWaha || new ClienteWahaHttp();
    const resultadoWaha = await clienteWaha.enviarMensagemGrupo({
      urlBase: env.WAHA_BASE_URL!,
      chaveApi: env.WAHA_API_KEY!,
      chatId: chatIdWaha,
      texto: notificacao.texto,
      sessao: env.WAHA_SESSION,
    });
    if (resultadoWaha.sucesso) {
      canaisSucesso.push("whatsapp_waha");
    } else {
      motivosFalha.push(
        `WAHA falhou: ${resultadoWaha.erro || `Status HTTP ${resultadoWaha.statusHttp}`}`,
      );
    }
  }

  // Se algum canal primário obteve sucesso, retorna 200
  if (canaisSucesso.length > 0) {
    const entregueVia = canaisSucesso.join("+");

    return new Response(
      JSON.stringify({ ok: true, entregueVia }),
      {
        status: 200,
        headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
      },
    );
  }

  // 4. Fallback automático via Resend quando todos os canais configurados falharem
  const clienteResend = env.clienteResend || new ClienteResendHttp();
  const motivoConsolidado = motivosFalha.length > 0
    ? motivosFalha.join(" | ")
    : "Nenhum canal primário (Discord, ntfy ou WAHA) configurado no ambiente.";

  await clienteResend.enviarEmailFallback({
    chaveApi: env.RESEND_API_KEY,
    remetente: env.EMAIL_REMETENTE_ALERTA || "alerta@login.arestaclimb.com",
    destinatario: env.EMAIL_DESTINATARIO_FALLBACK || "contato@arestaclimb.com",
    assunto: notificacao.assuntoFallback,
    texto: notificacao.texto,
    motivoFalhaWaha: motivoConsolidado,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      entregueVia: "resend_fallback",
      motivoFalhaWaha: motivoConsolidado,
    }),
    {
      status: 200,
      headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
    },
  );
}

/**
 * Reprocessa itens pendentes na fila de retentativas (acionado pelo Cron Trigger `scheduled`).
 */
export async function processarFilaRetentativas(env: AmbienteAlertas): Promise<void> {
  const fila = obterFilaRetentativas(env);
  if (!fila) {
    return;
  }

  const pendentes = await fila.listarPendentes();
  const clienteGithub = obterClienteGithubApp(env);
  const clienteDiscord = env.clienteDiscord || new ClienteDiscordHttp();
  const clienteNtfy = env.clienteNtfy || new ClienteNtfyHttp();

  for (const item of pendentes) {
    if (item.tipo === "criar_issue_emergencia" && item.dadosIssue && clienteGithub) {
      const resIssue = await clienteGithub.criarIssueEmergencia({
        clientId: env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID || "",
        privateKey: env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY || "",
        installationId: env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID || "",
        repositorio: item.dadosIssue.repositorio,
        titulo: item.dadosIssue.titulo,
        corpo: item.dadosIssue.corpo,
        labels: item.dadosIssue.labels,
      });

      if (resIssue.sucesso && resIssue.urlIssue) {
        await fila.remover(item.id);
        if (env.DISCORD_WEBHOOK_EMERGENCIAS_URL) {
          await clienteDiscord.enviarMensagemWebhook({
            urlWebhook: env.DISCORD_WEBHOOK_EMERGENCIAS_URL,
            texto: formatarTextoMuralDiscord(
              `✅ *[ISSUE DE EMERGÊNCIA CRIADA] ${item.dadosIssue.titulo}*\n• *Discussão GitHub:* ${resIssue.urlIssue} (#${resIssue.numeroIssue})`,
            ),
            avatarUrl: URL_ICONE_EMERGENCIA,
          });
        }
      }
    } else if (item.tipo === "enviar_notificacao_discord" && item.dadosDiscord) {
      const ehEmergencia = item.dadosDiscord.categoria === "emergencias";
      const urlDestino = ehEmergencia
        ? env.DISCORD_WEBHOOK_EMERGENCIAS_URL
        : env.DISCORD_WEBHOOK_BUGS_URL;

      if (urlDestino) {
        const resDiscord = await clienteDiscord.enviarMensagemWebhook({
          urlWebhook: urlDestino,
          texto: formatarTextoMuralDiscord(item.dadosDiscord.texto),
          avatarUrl: ehEmergencia ? URL_ICONE_EMERGENCIA : URL_ICONE_FEEDBACK_BUGS,
        });
        if (resDiscord.sucesso) {
          await fila.remover(item.id);
        }
      }
    } else if (item.tipo === "enviar_notificacao_ntfy" && item.dadosNtfy) {
      const resNtfy = await clienteNtfy.enviarNotificacaoPush(item.dadosNtfy);
      if (resNtfy.sucesso) {
        await fila.remover(item.id);
      }
    }
  }
}

function decodificarBase64ParaBytes(base64: string): Uint8Array {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

export async function processarRequisicaoAlertas(
  requisicao: Request,
  env: AmbienteAlertas,
): Promise<Response> {
  if (requisicao.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CABECALHOS_PADRAO });
  }

  const url = new URL(requisicao.url);
  const caminho = url.pathname.replace(/\/+$/, "") || "/";

  if (requisicao.method === "GET" && (caminho === "/" || caminho === "/health")) {
    return new Response(
      JSON.stringify({
        status: "operacional",
        servico: "aresta-alertas-worker",
      }),
      {
        status: 200,
        headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
      },
    );
  }

  if (
    requisicao.method === "GET" &&
    (caminho === "/icones/emergencia.webp" || caminho === "/icones/feedback_bugs.webp")
  ) {
    const base64Icone = caminho === "/icones/emergencia.webp"
      ? ICONE_EMERGENCIA_WEBP_BASE64
      : ICONE_FEEDBACK_BUGS_WEBP_BASE64;
    const bytes = decodificarBase64ParaBytes(base64Icone);
    return new Response(bytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...CABECALHOS_PADRAO,
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (requisicao.method !== "POST") {
    return new Response(
      JSON.stringify({ erro: "Método não permitido. Utilize POST." }),
      {
        status: 405,
        headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
      },
    );
  }

  if (caminho === "/webhook/sentry") {
    const assinaturaRecebida = requisicao.headers.get("sentry-hook-signature") || "";
    const corpoBruto = await requisicao.text();
    const assinaturaEsperada = await assinarHmacSha256Hex(
      env.SENTRY_WEBHOOK_SECRET || "",
      corpoBruto,
    );

    if (!assinaturaRecebida || !compararTempoConstante(assinaturaRecebida, assinaturaEsperada)) {
      return new Response(
        JSON.stringify({ erro: "Assinatura HMAC do Sentry inválida ou ausente." }),
        {
          status: 401,
          headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
        },
      );
    }

    const recurso = requisicao.headers.get("sentry-hook-resource") || "event_alert";
    const payload = JSON.parse(corpoBruto);
    const acaoSentry = String(payload?.action || "");

    // Sincronização Bidirecional Sentry -> GitHub (resolved / archived / ignored / unresolved)
    if (
      recurso === "issue" &&
      (acaoSentry === "resolved" ||
        acaoSentry === "archived" ||
        acaoSentry === "ignored" ||
        acaoSentry === "unresolved")
    ) {
      const idIssueSentry = String(payload?.data?.issue?.id || "");
      const clienteGithub = obterClienteGithubApp(env);
      if (idIssueSentry && clienteGithub) {
        const novoEstado = acaoSentry === "unresolved" ? "open" : "closed";
        const resSync = await clienteGithub.sincronizarEstadoIssuePorIdSentry({
          clientId: env.ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID || "",
          privateKey: env.ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY || "",
          installationId: env.ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID || "",
          idIssueSentry,
          novoEstado,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            sincronizadoGithub: resSync.sucesso,
            novoEstado,
            issuesAtualizadas: resSync.issuesAtualizadas,
          }),
          {
            status: 200,
            headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
          },
        );
      }
    }

    const notificacao = classificarWebhookSentry(recurso, payload, env);

    if (!notificacao) {
      return new Response(
        JSON.stringify({ ok: true, ignorado: true }),
        {
          status: 200,
          headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
        },
      );
    }

    return await despacharNotificacaoComFallback(notificacao, env);
  }

  if (caminho === "/webhook/github") {
    const cabecalhoAssinatura = requisicao.headers.get("x-hub-signature-256") || "";
    const corpoBruto = await requisicao.text();
    const hashEsperado = await assinarHmacSha256Hex(
      env.GITHUB_WEBHOOK_SECRET || "",
      corpoBruto,
    );
    const assinaturaEsperada = `sha256=${hashEsperado}`;

    if (!cabecalhoAssinatura || !compararTempoConstante(cabecalhoAssinatura, assinaturaEsperada)) {
      return new Response(
        JSON.stringify({ erro: "Assinatura HMAC do GitHub inválida ou ausente." }),
        {
          status: 401,
          headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
        },
      );
    }

    const eventoGithub = requisicao.headers.get("x-github-event") || "";
    const payload = JSON.parse(corpoBruto);
    const acaoGithub = String(payload?.action || "");

    // Sincronização Bidirecional GitHub -> Sentry (quando humano fecha ou reabre issue vinculada ao Sentry)
    if (eventoGithub === "issues" && (acaoGithub === "closed" || acaoGithub === "reopened")) {
      const tipoSender = String(payload?.sender?.type || "");
      const loginSender = String(payload?.sender?.login || "").toLowerCase();
      const ehBot = tipoSender === "Bot" || loginSender.includes("aresta-climb-bot");

      if (!ehBot && (env.SENTRY_API_TOKEN || env.clienteSentry)) {
        const idSentry = extrairIdIssueSentryDoCorpo(String(payload?.issue?.body || ""));
        if (idSentry) {
          const clienteSentry = env.clienteSentry || new ClienteSentryHttp();
          await clienteSentry.atualizarStatusIssue({
            tokenApi: env.SENTRY_API_TOKEN || "",
            idIssueSentry: idSentry,
            novoStatus: acaoGithub === "closed" ? "resolved" : "unresolved",
          });
        }
      }

      if (acaoGithub === "closed") {
        return new Response(
          JSON.stringify({ ok: true, sincronizadoSentry: !ehBot }),
          {
            status: 200,
            headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
          },
        );
      }
    }

    const notificacao = classificarWebhookGithub(eventoGithub, payload, env);

    if (!notificacao) {
      return new Response(
        JSON.stringify({ ok: true, ignorado: true }),
        {
          status: 200,
          headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
        },
      );
    }

    return await despacharNotificacaoComFallback(notificacao, env);
  }

  return new Response(
    JSON.stringify({ erro: "Rota de webhook não encontrada." }),
    {
      status: 404,
      headers: { ...CABECALHOS_PADRAO, "Content-Type": "application/json" },
    },
  );
}

export default Sentry.withSentry(
  (env: AmbienteAlertas) => ({
    dsn: env.SENTRY_DSN,
    beforeSend(event: any) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["sentry-hook-signature"];
        delete event.request.headers["x-hub-signature-256"];
      }
      return event;
    },
  }),
  {
    fetch(requisicao: Request, env: AmbienteAlertas): Promise<Response> {
      return processarRequisicaoAlertas(requisicao, env);
    },
    scheduled(_controller: any, env: AmbienteAlertas): Promise<void> {
      return processarFilaRetentativas(env);
    },
  },
);
