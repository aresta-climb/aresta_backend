// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  reescreverCaminhosMidiaXhtml,
  renderizarPaginaPublicaLaudo,
} from "./renderizador_pagina_laudo.ts";

Deno.test("renderizador_pagina_laudo: reescreve caminhos de mídia e materiais e injeta barra de verificação criptográfica e versões", () => {
  const xhtml = `<html><body>
    <img src="midia/foto_1.webp" />
    <video src="midia/video_1.mp4" poster="midia/video_1.jpg"></video>
    <a href="materiais/mat_123/relatorio.xhtml">Material</a>
  </body></html>`;

  const reescrito = reescreverCaminhosMidiaXhtml({
    xhtml,
    idSessao: "sessao_1",
    versao: 2,
  });
  assertEquals(
    reescrito.includes('src="/v/sessao_1/midias/OEBPS/midia/foto_1.webp?v=2"'),
    true,
  );
  assertEquals(
    reescrito.includes('poster="/v/sessao_1/midias/OEBPS/midia/video_1.jpg?v=2"'),
    true,
  );
  assertEquals(reescrito.includes('href="/v/mat_123"'), true);

  const v1 = {
    id_sessao: "sessao_1",
    versao: 1,
    r2_key: "laudos/sessao_1/v1.epub",
    tamanho_bytes: 100,
    hash_epub_sha256: "h1",
    fingerprint_chave: "abcdef0123456789abcdef0123456789",
    nome_mantenedor: "Renato Ferreira",
    clube_mantenedor: "FEMERJ",
    indices_zip_json: "{}",
    materiais_referenciados_json: "[]",
    status_moderacao: "ativo",
    motivo_moderacao: null,
    criado_em: "2026-11-08T00:00:00Z",
  };
  const v2 = { ...v1, versao: 2, r2_key: "laudos/sessao_1/v2.epub" };

  const html = renderizarPaginaPublicaLaudo({
    laudo: {
      id_sessao: "sessao_1",
      user_id: "usr_1",
      categoria: "MANUTENCAO",
      id_protocolo: "manutencao_ferragens",
      titulo: "Via Teste",
      escalada_uid: null,
      latitude: null,
      longitude: null,
      versao_atual: 2,
      criado_em: "2026-11-08T00:00:00Z",
      atualizado_em: "2026-11-08T01:00:00Z",
    },
    versaoExibida: v2,
    todasVersoes: [v1, v2],
    chaveInfo: {
      fingerprint_sha256: v1.fingerprint_chave,
      user_id: "usr_1",
      chave_publica_pem: "PEM",
      certificado_x509_pem: "X509",
      atestado_oidc_jwt: "JWT",
      provedor_oidc: "google",
      nome_declarado: "Renato Ferreira",
      clube_declarado: "FEMERJ",
      criado_em: "2026-01-01T00:00:00Z",
    },
    totalLaudosAssinadosPelaChave: 7,
    xhtmlOriginal: xhtml,
    cssOriginal: "body { margin: 0; }",
  });

  assertEquals(
    html.includes("Assinatura XML-DSig ECDSA P-256 Íntegra"),
    true,
  );
  assertEquals(
    html.includes("7 laudo(s) assinado(s) por esta chave"),
    true,
  );
  assertEquals(html.includes('href="/v/sessao_1?v=1"'), true);
  assertEquals(html.includes('href="/v/sessao_1?v=2"'), true);
});
