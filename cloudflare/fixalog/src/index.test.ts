// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { construirZipEpubEmMemoria } from "./extrator_indice_epub.ts";
import { construirMp4ComAtomosStssTeste } from "./extrator_iframes_mp4.ts";
import { AmbienteFixalogFake } from "./fakes/ambiente_fixalog_fake.ts";
import workerDefault from "./index.ts";
import {
  calcularSha256Base64,
  construirTokensAssinadosTeste,
} from "./verificador_assinatura_laudo.ts";

async function criarEpubAssinadoTeste(params: {
  titulo: string;
  atestadoOidcJwt: string;
  incluirVideo?: boolean;
}): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const xhtml = `<html><head><title>${params.titulo}</title></head><body><h1>${params.titulo}</h1><img src="midia/foto_1.webp" /><video id="video-v1" src="midia/video_1.mp4" poster="midia/video_1.jpg"></video></body></html>`;
  const css = "body { font-family: sans-serif; }";
  const foto = new Uint8Array([10, 20, 30, 40]);
  const video = construirMp4ComAtomosStssTeste([1, 301]);

  const xhtmlBytes = encoder.encode(xhtml);
  const cssBytes = encoder.encode(css);
  const digestXhtml = await calcularSha256Base64(xhtmlBytes);
  const digestCss = await calcularSha256Base64(cssBytes);
  const digestFoto = await calcularSha256Base64(foto);
  const digestVideo = await calcularSha256Base64(video);

  const signaturesXml = `<?xml version="1.0" encoding="UTF-8"?>
<signatures xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <Reference URI="OEBPS/relatorio.xhtml"><DigestValue>${digestXhtml}</DigestValue></Reference>
      <Reference URI="OEBPS/estilo.css"><DigestValue>${digestCss}</DigestValue></Reference>
      <Reference URI="OEBPS/midia/foto_1.webp"><DigestValue>${digestFoto}</DigestValue></Reference>
      ${
        params.incluirVideo
          ? `<Reference URI="OEBPS/midia/video_1.mp4"><DigestValue>${digestVideo}</DigestValue></Reference>`
          : ""
      }
    </SignedInfo>
    <SignatureValue>Y2hhdmVfYXNzaW5hdHVyYV9lY2RzYV92YWxpZGFfMTIzNDU2</SignatureValue>
    <KeyInfo><X509Data><X509Certificate>TUVVX0NFUlRfVEVTVEU=</X509Certificate></X509Data></KeyInfo>
    <Object Id="oidc-attestation"><OidcIdToken>${params.atestadoOidcJwt}</OidcIdToken></Object>
  </Signature>
</signatures>`;

  const entradas = [
    { nome: "OEBPS/relatorio.xhtml", dados: xhtmlBytes },
    { nome: "OEBPS/estilo.css", dados: cssBytes },
    { nome: "OEBPS/midia/foto_1.webp", dados: foto },
    ...(params.incluirVideo
      ? [{ nome: "OEBPS/midia/video_1.mp4", dados: video }]
      : []),
    { nome: "META-INF/signatures.xml", dados: encoder.encode(signaturesXml) },
  ];

  return construirZipEpubEmMemoria(entradas);
}

Deno.test("fixalog-worker: fluxo ponta a ponta de upload v1 e v2, moderação assíncrona, visualização pública, Byte-Range 206 e denúncia", async () => {
  const env = new AmbienteFixalogFake();
  const tokens = await construirTokensAssinadosTeste({
    userId: "usr_renato",
    nome: "Renato Ferreira",
  });

  // 1. Healthcheck e OPTIONS
  const resOpt = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos", { method: "OPTIONS" }),
    env,
  );
  assertEquals(resOpt.status, 204);

  const resHealth = await workerDefault.fetch(
    new Request("https://fixalog.app/health"),
    env,
  );
  assertEquals(resHealth.status, 200);

  // 2. Registro de chave pública
  const resChave = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/chaves", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokens.jwtSupabase}`,
      },
      body: JSON.stringify({
        chave_publica_pem: tokens.chavePublicaPem,
        certificado_x509_pem: tokens.chavePublicaPem,
        atestado_oidc_jwt: tokens.atestadoOidcJwt,
        provedor_oidc: "google",
        nome_declarado: "Renato Ferreira",
        clube_declarado: "FEMERJ",
      }),
    }),
    env,
  );
  assertEquals(resChave.status, 201);

  // 3. Upload v1 do laudo
  const epubV1 = await criarEpubAssinadoTeste({
    titulo: "Via Aresta — v1",
    atestadoOidcJwt: tokens.atestadoOidcJwt,
    incluirVideo: true,
  });

  const resUploadV1 = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_aresta", {
      method: "PUT",
      headers: {
        "Content-Type": "application/epub+zip",
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokens.jwtSupabase}`,
      },
      body: epubV1 as unknown as BodyInit,
    }),
    env,
    env.contexto,
  );
  assertEquals(resUploadV1.status, 201);
  const jsonV1 = await resUploadV1.json();
  assertEquals(jsonV1.versao, 1);
  assertEquals(jsonV1.status_moderacao, "em_analise");

  // Antes da fila background concluir, GET /v/sessao_aresta retorna 202 Accepted (Gatekeeper)
  const resEmAnalise = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta"),
    env,
  );
  assertEquals(resEmAnalise.status, 202);

  // Conclui a moderação em background -> promove para 'ativo'
  await env.aguardarTarefasBackground();

  // 4. Upload v2 pelo mesmo usuário -> cria versão imutável v2
  const epubV2 = await criarEpubAssinadoTeste({
    titulo: "Via Aresta — v2 Atualizada",
    atestadoOidcJwt: tokens.atestadoOidcJwt,
    incluirVideo: true,
  });
  const resUploadV2 = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_aresta", {
      method: "PUT",
      headers: {
        "Content-Type": "application/epub+zip",
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokens.jwtSupabase}`,
      },
      body: epubV2 as unknown as BodyInit,
    }),
    env,
  );
  assertEquals(resUploadV2.status, 201);
  const jsonV2 = await resUploadV2.json();
  assertEquals(jsonV2.versao, 2);

  // Outra conta tentando sobrescrever sessao_aresta recebe 403 Forbidden
  const tokensOutro = await construirTokensAssinadosTeste({
    userId: "usr_invasor",
  });
  const resInvasor = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_aresta", {
      method: "PUT",
      headers: {
        "Content-Type": "application/epub+zip",
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokensOutro.jwtSupabase}`,
      },
      body: epubV2 as unknown as BodyInit,
    }),
    env,
  );
  assertEquals(resInvasor.status, 403);

  // 5. Listagem dos laudos da conta
  const resLista = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos", {
      headers: {
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokens.jwtSupabase}`,
      },
    }),
    env,
  );
  assertEquals(resLista.status, 200);
  const listaJson = await resLista.json();
  assertEquals(listaJson.laudos.length, 1);
  assertEquals(listaJson.laudos[0].versao_atual, 2);

  // 6. Visualização pública de GET /v/sessao_aresta (v2 padrão e ?v=1)
  const resPaginaV2 = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta"),
    env,
  );
  assertEquals(resPaginaV2.status, 200);
  const htmlV2 = await resPaginaV2.text();
  assertEquals(htmlV2.includes("Via Aresta — v2 Atualizada"), true);
  assertEquals(htmlV2.includes("1 laudo(s) assinado(s) por esta chave"), true);
  assertEquals(htmlV2.includes('href="/v/sessao_aresta?v=1"'), true);

  const resPaginaV1 = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta?v=1"),
    env,
  );
  assertEquals(resPaginaV1.status, 200);
  assertEquals((await resPaginaV1.text()).includes("Via Aresta — v1"), true);

  // 7. Streaming Byte-Range 206 Partial Content de mídia
  const resMidia206 = await workerDefault.fetch(
    new Request(
      "https://fixalog.app/v/sessao_aresta/midias/OEBPS/midia/foto_1.webp?v=2",
      {
        headers: { Range: "bytes=1-2" },
      },
    ),
    env,
  );
  assertEquals(resMidia206.status, 206);
  assertEquals(
    Array.from(new Uint8Array(await resMidia206.arrayBuffer())),
    [20, 30],
  );

  // 8. Download do .epub assinado e resumo .pdf
  const resEpub = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta/epub?v=2"),
    env,
  );
  assertEquals(resEpub.status, 200);
  assertEquals(resEpub.headers.get("Content-Type"), "application/epub+zip");

  const resPdf = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta/pdf?v=2"),
    env,
  );
  assertEquals(resPdf.status, 302);

  // 9. Denúncia suspende a versão e dispara alerta para alertas.arestaclimb.com
  const resDenuncia = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_aresta/denunciar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        motivo: "Conteúdo impróprio",
        detalhes: "Teste de denúncia",
      }),
    }),
    env,
  );
  assertEquals(resDenuncia.status, 200);

  const resAposDenuncia = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta?v=2"),
    env,
  );
  assertEquals(resAposDenuncia.status, 451);
});
