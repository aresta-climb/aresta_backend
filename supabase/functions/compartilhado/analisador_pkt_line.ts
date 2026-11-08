// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

const OID_ZEROS = "0000000000000000000000000000000000000000";

export interface ComandoGitRef {
  idAntigo: string;
  idNovo: string;
  nomeReferencia: string;
  ehCriacao: boolean;
  ehExclusao: boolean;
  ehAtualizacao: boolean;
}

export function criarLinhaPktLine(conteudo: string): Uint8Array {
  const comprimento = conteudo.length + 4;
  const hex = comprimento.toString(16).padStart(4, "0");
  return new TextEncoder().encode(`${hex}${conteudo}`);
}

export function extrairComandosGit(buffer: Uint8Array): ComandoGitRef[] {
  const comandos: ComandoGitRef[] = [];
  let deslocamento = 0;
  const decodificador = new TextDecoder();

  while (deslocamento + 4 <= buffer.length) {
    const cabecalhoHex = decodificador.decode(buffer.subarray(deslocamento, deslocamento + 4));
    const tamanho = parseInt(cabecalhoHex, 16);

    if (isNaN(tamanho) || tamanho === 0) {
      // Flush packet '0000' ou delimitador
      deslocamento += 4;
      break;
    }

    if (tamanho < 4 || deslocamento + tamanho > buffer.length) {
      break;
    }

    const dadosLinha = buffer.subarray(deslocamento + 4, deslocamento + tamanho);
    deslocamento += tamanho;

    let linhaTexto = decodificador.decode(dadosLinha);
    // Limpar caractere nulo e capacidades se presentes
    if (linhaTexto.includes("\0")) {
      linhaTexto = linhaTexto.split("\0")[0];
    }
    linhaTexto = linhaTexto.trim();

    const partes = linhaTexto.split(/\s+/);
    if (partes.length >= 3) {
      const idAntigo = partes[0];
      const idNovo = partes[1];
      const nomeReferencia = partes[2];

      const ehCriacao = idAntigo === OID_ZEROS;
      const ehExclusao = idNovo === OID_ZEROS;
      const ehAtualizacao = !ehCriacao && !ehExclusao;

      comandos.push({
        idAntigo,
        idNovo,
        nomeReferencia,
        ehCriacao,
        ehExclusao,
        ehAtualizacao,
      });
    }
  }

  return comandos;
}

/**
 * Inspeciona a resposta pkt-line (direta ou encapsulada em side-band-64k) do git-receive-pack
 * e retorna todas as mensagens de erro de desempacotamento ('unpack != ok'),
 * recusas de referência ('ng <ref> <motivo>') ou erros fatais do canal 3.
 */
export function extrairErrosResultadoReceivePack(buffer: Uint8Array): string[] {
  const erros: string[] = [];
  let deslocamento = 0;
  const decodificador = new TextDecoder();

  while (deslocamento + 4 <= buffer.length) {
    const cabecalhoHex = decodificador.decode(buffer.subarray(deslocamento, deslocamento + 4));
    const tamanho = parseInt(cabecalhoHex, 16);

    if (isNaN(tamanho)) {
      break;
    }
    if (tamanho === 0) {
      deslocamento += 4;
      continue;
    }
    if (tamanho < 4 || deslocamento + tamanho > buffer.length) {
      break;
    }

    const dadosLinha = buffer.subarray(deslocamento + 4, deslocamento + tamanho);
    deslocamento += tamanho;
    if (dadosLinha.length === 0) {
      continue;
    }

    const canal = dadosLinha[0];
    if (canal === 1) {
      erros.push(...extrairErrosResultadoReceivePack(dadosLinha.subarray(1)));
      continue;
    }
    if (canal === 2) {
      continue;
    }
    if (canal === 3) {
      const erroFatal = decodificador.decode(dadosLinha.subarray(1)).trim();
      if (erroFatal) {
        erros.push(erroFatal);
      }
      continue;
    }

    let linhaTexto = decodificador.decode(dadosLinha);
    if (linhaTexto.includes("\0")) {
      linhaTexto = linhaTexto.split("\0")[0];
    }
    linhaTexto = linhaTexto.trim();

    if (linhaTexto.startsWith("unpack ") && linhaTexto !== "unpack ok") {
      erros.push(linhaTexto);
    } else if (linhaTexto.startsWith("ng ")) {
      erros.push(linhaTexto);
    }
  }

  return erros;
}
