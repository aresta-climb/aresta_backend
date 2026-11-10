// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import {
  LinhaChavesUsuarioFixalog,
  LinhaLaudosFixalog,
  LinhaVersoesLaudoFixalog,
} from "../../../aresta_api/sql/generated/ts/fixalog_d1_sql.ts";

/**
 * Representa o conteúdo XHTML de um material anexo embutido dentro do `.epub` principal
 * (`OEBPS/materiais/<idMaterial>/relatorio.xhtml`) para impressão unificada no navegador.
 */
export interface MaterialAnexoXhtml {
  idMaterial: string;
  xhtml: string;
  prefixoInternoOebps?: string;
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function obterNomeProtocoloAmigavel(
  idProtocolo: string,
  categoria: string,
): string {
  if (
    idProtocolo === "material_registration" ||
    categoria.toUpperCase() === "MATERIAL"
  ) {
    return "Cadastro Técnico de Material";
  }
  return "Laudo de Manutenção de Ferragens";
}

function extrairResumoMidiasDoIndice(indicesZipJson: string): {
  totalFotos: number;
  totalVideos: number;
  primeiraFotoCaminho: string | null;
} {
  let indice: Record<string, unknown> = {};
  try {
    indice = JSON.parse(indicesZipJson) as Record<string, unknown>;
  } catch {
    indice = {};
  }

  let totalFotos = 0;
  let totalVideos = 0;
  let primeiraFotoCaminho: string | null = null;
  let primeiroPosterCaminho: string | null = null;

  for (const chave of Object.keys(indice)) {
    const lower = chave.toLowerCase();
    if (!/midias?\//.test(lower)) {
      continue;
    }
    if (/_kf_\d+s\.jpe?g$/.test(lower)) {
      continue;
    }
    if (lower.endsWith("_poster.jpg")) {
      if (!primeiroPosterCaminho) {
        primeiroPosterCaminho = chave;
      }
      continue;
    }
    if (
      lower.endsWith(".webp") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png")
    ) {
      totalFotos++;
      if (!primeiraFotoCaminho) {
        primeiraFotoCaminho = chave;
      }
    } else if (lower.endsWith(".mp4") || lower.endsWith(".webm")) {
      totalVideos++;
    }
  }

  return {
    totalFotos,
    totalVideos,
    primeiraFotoCaminho: primeiraFotoCaminho ?? primeiroPosterCaminho,
  };
}

/**
 * Reescreve os caminhos internos de mídia (`midia/...` ou `midias/...`) e links de materiais (`materiais/<uuid>/relatorio.xhtml`)
 * do `OEBPS/relatorio.xhtml` para apontarem para as rotas Byte-Range e páginas públicas do Worker.
 */
export function reescreverCaminhosMidiaXhtml(params: {
  xhtml: string;
  idSessao: string;
  versao: number;
  prefixoInternoOebps?: string;
}): string {
  const { xhtml, idSessao, versao, prefixoInternoOebps = "OEBPS" } = params;
  const idSeguro = encodeURIComponent(idSessao);

  // Reescreve src="midia(s)/...", poster="midia(s)/..." e href="midia(s)/..."
  let transformado = xhtml.replace(
    /\b(src|poster|href)="(midias?)\/([^"]+)"/g,
    (_m, attr, pastaMidia, arquivo) =>
      `${attr}="/v/${idSeguro}/midias/${prefixoInternoOebps}/${pastaMidia}/${arquivo}?v=${versao}"`,
  );

  // Reescreve links de materiais aninhados href="materiais/<uuid>/(OEBPS/)?relatorio.xhtml" -> href="/v/<uuid>"
  transformado = transformado.replace(
    /\bhref="materiais\/([^/"]+)\/(?:OEBPS\/)?relatorio\.xhtml"/g,
    (_m, uuidMat) => `href="/v/${encodeURIComponent(uuidMat)}"`,
  );

  return transformado;
}

/**
 * Renderiza a página pública HTML5 de visualização do laudo (`GET /v/:id`) com:
 * - Meta tags OpenGraph (`og:title`, `og:description`, `og:image`, `og:url`) para preview rico no WhatsApp
 * - Barra superior de verificação criptográfica (XML-DSig ECDSA P-256 + OpenPubkey OIDC +
 *   histórico da chave pública e contagem em tempo real de laudos assinados no D1)
 * - Seletor de versões imutáveis (`v1`, `v2`...)
 * - Botão principal de download do `.epub` assinado e opção discreta de exportar/imprimir PDF pelo navegador
 * - Seção anexa de fichas de materiais referenciados para impressão unificada (`@media print`)
 */
export function renderizarPaginaPublicaLaudo(params: {
  laudo: LinhaLaudosFixalog;
  versaoExibida: LinhaVersoesLaudoFixalog;
  todasVersoes: LinhaVersoesLaudoFixalog[];
  chaveInfo: LinhaChavesUsuarioFixalog | null;
  totalLaudosAssinadosPelaChave: number;
  xhtmlOriginal: string;
  cssOriginal: string;
  materiaisAnexosXhtml?: MaterialAnexoXhtml[];
}): string {
  const {
    laudo,
    versaoExibida,
    todasVersoes,
    chaveInfo,
    totalLaudosAssinadosPelaChave,
    xhtmlOriginal,
    cssOriginal,
    materiaisAnexosXhtml = [],
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

  const nomeProtocolo = obterNomeProtocoloAmigavel(
    laudo.id_protocolo,
    laudo.categoria,
  );
  const resumoMidias = extrairResumoMidiasDoIndice(
    versaoExibida.indices_zip_json,
  );
  const idSessaoUrl = encodeURIComponent(laudo.id_sessao);
  const urlCanonica = `https://fixalog.app/v/${idSessaoUrl}`;
  const ogTitle = `${escaparHtml(laudo.titulo)} — ${escaparHtml(nomeProtocolo)} (Fixalog v${versaoExibida.versao})`;
  const ogDescription = `Autor: ${escaparHtml(versaoExibida.nome_mantenedor)}${clubeTexto} • ${resumoMidias.totalFotos} foto(s), ${resumoMidias.totalVideos} vídeo(s) • Assinado digitalmente ECDSA P-256 (Fixalog v${versaoExibida.versao})`;
  const metaOgImage = resumoMidias.primeiraFotoCaminho
    ? `\n  <meta property="og:image" content="https://fixalog.app/v/${idSessaoUrl}/midias/${resumoMidias.primeiraFotoCaminho}?v=${versaoExibida.versao}" />`
    : "";

  const linksVersoes = todasVersoes
    .map((v) => {
      const ativa = v.versao === versaoExibida.versao;
      const classe = ativa ? "pilula-versao ativa" : "pilula-versao";
      return `<a class="${classe}" href="/v/${idSessaoUrl}?v=${v.versao}">v${v.versao}</a>`;
    })
    .join(" ");

  const secaoMateriaisAnexos =
    materiaisAnexosXhtml.length > 0
      ? `<section class="anexo-materiais-impressao">
    ${materiaisAnexosXhtml
      .map((mat) => {
        const reescritoMat = reescreverCaminhosMidiaXhtml({
          xhtml: mat.xhtml,
          idSessao: laudo.id_sessao,
          versao: versaoExibida.versao,
          prefixoInternoOebps:
            mat.prefixoInternoOebps ??
            `OEBPS/materiais/${encodeURIComponent(mat.idMaterial)}`,
        });
        const matchBodyMat = reescritoMat.match(
          /<body[^>]*>([\s\S]*?)<\/body>/i,
        );
        const corpoMat = matchBodyMat ? matchBodyMat[1] : reescritoMat;
        return `<article class="ficha-material-anexo" data-material-id="${escaparHtml(mat.idMaterial)}">${corpoMat}</article>`;
      })
      .join("\n    ")}
  </section>`
      : "";

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: laudo.titulo,
    datePublished: laudo.criado_em,
    dateModified: versaoExibida.criado_em,
    version: String(versaoExibida.versao),
    author: {
      "@type": "Person",
      name: versaoExibida.nome_mantenedor,
    },
    mainEntityOfPage: urlCanonica,
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="index, follow" />
  <meta name="description" content="${ogDescription}" />
  <link rel="canonical" href="${urlCanonica}" />
  <title>${escaparHtml(laudo.titulo)} — Fixalog v${versaoExibida.versao}</title>
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDescription}" />
  <meta property="og:url" content="${urlCanonica}" />
  <meta name="twitter:card" content="summary_large_image" />${metaOgImage}
  <script type="application/ld+json">${jsonLd}</script>
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
    .acoes-laudo .acao-secundaria-pdf {
      color: #90a4ae;
      font-weight: 400;
      font-size: 12px;
      cursor: pointer;
      background: transparent;
      border: 1px solid #37474f;
      border-radius: 4px;
      padding: 2px 8px;
    }
    .anexo-materiais-impressao {
      margin-top: 32px;
      border-top: 2px dashed #ccc;
      padding-top: 24px;
    }
    @media print {
      .barra-verificacao-fixalog {
        display: none !important;
      }
      .anexo-materiais-impressao,
      .ficha-material-anexo {
        page-break-before: always;
        break-before: page;
      }
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
      <a href="/v/${idSessaoUrl}/epub?v=${versaoExibida.versao}">Baixar .epub Assinado</a>
      <button type="button" class="acao-secundaria-pdf" onclick="window.print()">Exportar PDF / Imprimir</button>
    </div>
  </header>
  ${corpoRelatorio}
  ${secaoMateriaisAnexos}
  <script>
    if (window.location.search.indexOf("print=1") !== -1) {
      window.addEventListener("load", function () {
        window.print();
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Renderiza a página de espera (`202 Accepted`) exibida enquanto a versão do laudo
 * está em análise assíncrona de segurança (`status_moderacao === 'em_analise'`),
 * com atualização automática assim que o processamento é concluído.
 */
export function renderizarPaginaEmAnaliseLaudo(params: {
  laudo: LinhaLaudosFixalog;
  versaoExibida: LinhaVersoesLaudoFixalog;
}): string {
  const { laudo, versaoExibida } = params;
  const clubeTexto = versaoExibida.clube_mantenedor
    ? ` (${escaparHtml(versaoExibida.clube_mantenedor)})`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <meta http-equiv="refresh" content="3" />
  <title>Em análise: ${escaparHtml(laudo.titulo)} — Fixalog v${versaoExibida.versao}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #121416;
      color: #f3f0e8;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
    }
    .cartao-analise {
      max-width: 520px;
      width: 100%;
      background: #1c1f22;
      border: 1px solid #2e343b;
      border-top: 3px solid #ffb74d;
      border-radius: 16px;
      padding: 32px 26px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
    }
    .spinner {
      width: 42px;
      height: 42px;
      margin: 0 auto 18px;
      border: 4px solid rgba(255, 183, 77, 0.2);
      border-top-color: #ffb74d;
      border-radius: 50%;
      animation: girar 0.9s linear infinite;
    }
    @keyframes girar {
      to { transform: rotate(360deg); }
    }
    .selo {
      display: inline-block;
      background: rgba(255, 183, 77, 0.14);
      color: #ffb74d;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    h1 {
      font-size: 21px;
      margin: 0 0 10px;
      color: #ffffff;
    }
    p {
      font-size: 14.5px;
      line-height: 1.55;
      color: #b0b8c1;
      margin: 0 0 14px;
    }
    .meta-autor {
      font-size: 13px;
      color: #8c96a2;
      border-top: 1px solid #2e343b;
      padding-top: 14px;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <main class="cartao-analise">
    <div class="spinner" aria-hidden="true"></div>
    <span class="selo">Processando Laudo v${versaoExibida.versao}</span>
    <h1>Laudo em verificação automática de segurança</h1>
    <p>O pacote pericial <strong>${escaparHtml(laudo.titulo)}</strong> já teve sua assinatura digital ECDSA P-256 validada e está passando pela verificação automática de mídias.</p>
    <p>Esta página será atualizada automaticamente assim que o laudo estiver disponível (geralmente em poucos segundos).</p>
    <div class="meta-autor">
      Autor verificado: <strong>${escaparHtml(versaoExibida.nome_mantenedor)}</strong>${clubeTexto}
    </div>
  </main>
  <script>
    setInterval(function () {
      fetch(window.location.href, { cache: "no-store" })
        .then(function (res) {
          if (res.status === 200 || res.status === 451) {
            window.location.reload();
          }
        })
        .catch(function () {});
    }, 2500);
  </script>
</body>
</html>`;
}
