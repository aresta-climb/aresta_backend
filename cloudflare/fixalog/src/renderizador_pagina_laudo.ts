// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  LinhaChavesUsuarioFixalog,
  LinhaLaudosFixalog,
  LinhaVersoesLaudoFixalog,
} from "../../../aresta_api/sql/generated/ts/fixalog_d1_sql.ts";

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Reescreve os caminhos internos de mídia (`midia/...`) e links de materiais (`materiais/<uuid>/relatorio.xhtml`)
 * do `OEBPS/relatorio.xhtml` para apontarem para as rotas Byte-Range e páginas públicas do Worker.
 */
export function reescreverCaminhosMidiaXhtml(params: {
  xhtml: string;
  idSessao: string;
  versao: number;
}): string {
  const { xhtml, idSessao, versao } = params;
  const idSeguro = encodeURIComponent(idSessao);

  // Reescreve src="midia/..." e poster="midia/..."
  let transformado = xhtml.replace(
    /\b(src|poster)="midia\/([^"]+)"/g,
    (_m, attr, arquivo) =>
      `${attr}="/v/${idSeguro}/midias/OEBPS/midia/${arquivo}?v=${versao}"`,
  );

  // Reescreve links de materiais aninhados href="materiais/<uuid>/relatorio.xhtml" -> href="/v/<uuid>"
  transformado = transformado.replace(
    /\bhref="materiais\/([^/"]+)\/relatorio\.xhtml"/g,
    (_m, uuidMat) => `href="/v/${encodeURIComponent(uuidMat)}"`,
  );

  return transformado;
}

/**
 * Renderiza a página pública HTML5 de visualização do laudo (`GET /v/:id`) com:
 * - Barra superior de verificação criptográfica (XML-DSig ECDSA P-256 + OpenPubkey OIDC +
 *   histórico da chave pública e contagem em tempo real de laudos assinados no D1)
 * - Seletor de versões imutáveis (`v1`, `v2`...)
 * - Botões de download do `.epub` assinado e denúncia
 */
export function renderizarPaginaPublicaLaudo(params: {
  laudo: LinhaLaudosFixalog;
  versaoExibida: LinhaVersoesLaudoFixalog;
  todasVersoes: LinhaVersoesLaudoFixalog[];
  chaveInfo: LinhaChavesUsuarioFixalog | null;
  totalLaudosAssinadosPelaChave: number;
  xhtmlOriginal: string;
  cssOriginal: string;
}): string {
  const {
    laudo,
    versaoExibida,
    todasVersoes,
    chaveInfo,
    totalLaudosAssinadosPelaChave,
    xhtmlOriginal,
    cssOriginal,
  } = params;

  const xhtmlReescrito = reescreverCaminhosMidiaXhtml({
    xhtml: xhtmlOriginal,
    idSessao: laudo.id_sessao,
    versao: versaoExibida.versao,
  });

  // Extrai o conteúdo interno de <body>...</body> se presente
  const matchBody = xhtmlReescrito.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const corpoRelatorio = matchBody ? matchBody[1] : xhtmlReescrito;

  const provedorOidc = (chaveInfo?.provedor_oidc ?? "google").toUpperCase();
  const fpCurto = versaoExibida.fingerprint_chave.slice(0, 16);
  const dataChave = chaveInfo?.criado_em ?? versaoExibida.criado_em;
  const clubeTexto = versaoExibida.clube_mantenedor
    ? ` (${escaparHtml(versaoExibida.clube_mantenedor)})`
    : "";

  const linksVersoes = todasVersoes
    .map((v) => {
      const ativa = v.versao === versaoExibida.versao;
      const classe = ativa ? "pilula-versao ativa" : "pilula-versao";
      return `<a class="${classe}" href="/v/${encodeURIComponent(
        laudo.id_sessao,
      )}?v=${v.versao}">v${v.versao}</a>`;
    })
    .join(" ");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escaparHtml(laudo.titulo)} — Fixalog v${versaoExibida.versao}</title>
  <style>
    ${cssOriginal}
    .barra-verificacao-fixalog {
      background: #121814;
      color: #e8f5e9;
      border-bottom: 2px solid #2e7d32;
      padding: 14px 20px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
    }
    .barra-verificacao-fixalog .linha-topo {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .selo-integro {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #1b5e20;
      color: #a5d6a7;
      padding: 4px 10px;
      border-radius: 999px;
      font-weight: 700;
    }
    .seletor-versoes {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pilula-versao {
      color: #a5d6a7;
      text-decoration: none;
      padding: 2px 8px;
      border: 1px solid #2e7d32;
      border-radius: 4px;
    }
    .pilula-versao.ativa {
      background: #2e7d32;
      color: #ffffff;
      font-weight: 700;
    }
    .acoes-laudo {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .acoes-laudo a {
      color: #ffb74d;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <header id="barra-verificacao-criptografica" class="barra-verificacao-fixalog">
    <div class="linha-topo">
      <div>
        <span class="selo-integro">✓ Assinatura XML-DSig ECDSA P-256 Íntegra</span>
        <span> • Atestado OIDC (${escaparHtml(provedorOidc)}) Verificado</span>
        <span> • Autor: <strong>${escaparHtml(versaoExibida.nome_mantenedor)}</strong>${clubeTexto}</span>
      </div>
      <div id="seletor-versoes-laudo" class="seletor-versoes">
        <span>Versões:</span>
        ${linksVersoes}
      </div>
    </div>
    <div class="acoes-laudo">
      <span>Chave ECDSA: <code>${escaparHtml(fpCurto)}…</code> (desde ${escaparHtml(dataChave)}) • <strong>${totalLaudosAssinadosPelaChave} laudo(s) assinado(s) por esta chave</strong></span>
      <a href="/v/${encodeURIComponent(laudo.id_sessao)}/epub?v=${versaoExibida.versao}">Baixar .epub Assinado</a>
      <a href="/v/${encodeURIComponent(laudo.id_sessao)}/pdf?v=${versaoExibida.versao}">Resumo .pdf</a>
    </div>
  </header>
  ${corpoRelatorio}
</body>
</html>`;
}
