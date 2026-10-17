// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { RequisicaoCriarSessaoPrevia } from "../../../aresta_api/openapi/generated/ts/previa.ts";

export interface DadosUsuarioAutenticado {
  idUsuario: string;
  email: string;
  nomeCompleto?: string;
}

export interface DadosInicioSessao {
  usuarioId: string;
  usuarioEmail: string;
  codigo: string;
  urlPrevia: string;
  ipOrigem?: string;
  ipLocal?: string;
  portaLocal?: number;
  userAgent?: string;
}

export interface DadosFimSessao {
  encerradoEm: string;
  duracaoSegundos: number;
  motivoEncerramento: string;
}

export interface MetadadosEditor extends RequisicaoCriarSessaoPrevia {
  urlLocal?: string;
  versaoApp?: string;
}

export interface SessaoAtiva {
  codigo: string; // Ex: 'k9x2p83a'
  socketEditor?: WebSocket;
  metadados: MetadadosEditor;
  ouvintes: Set<WebSocket>;
  criadoEm: number;
  ultimoAcessoEm: number;
  usuarioId?: string;
  usuarioEmail?: string;
  idAuditoria?: string;
  ipOrigem?: string;
  userAgent?: string;
  requisicoesPendentes: Map<string, (resposta: RespostaProxy) => void>;
}

export interface RequisicaoProxy {
  id: string;
  metodo: string;
  caminho: string;
  cabecalhos: Record<string, string>;
}

export interface RespostaProxy {
  id: string;
  status: number;
  cabecalhos: Record<string, string>;
  corpoBase64?: string;
}

export interface MensagemEvento {
  tipo: "evento" | "registro" | "requisicao_proxy" | "resposta_proxy" | "ping" | "pong";
  dados?: any;
}
