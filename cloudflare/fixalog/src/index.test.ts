// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { construirZipEpubEmMemoria } from "./extrator_indice_epub.ts";
import { construirMp4ComAtomosStssTeste } from "./extrator_iframes_mp4.ts";
import { AmbienteFixalogFake } from "./fakes/ambiente_fixalog_fake.ts";
import workerDefault from "./index.ts";
import { gerarTokenHmacCsamScan } from "./moderador_midia_ia.ts";
import {
  calcularSha256Base64,
  calcularSha256Hex,
  construirTokensAssinadosTeste,
} from "./verificador_assinatura_laudo.ts";

async function comprimirDeflateRaw(dados: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(dados)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function criarEpubAssinadoTeste(params: {
  titulo: string;
  atestadoOidcJwt: string;
  incluirVideo?: boolean;
  incluirMaterialAnexo?: boolean;
  comprimirXhtmlComDeflate?: boolean;
  quantidadeFotosExtras?: number;
}): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const linkMaterial = params.incluirMaterialAnexo
    ? '<a href="materiais/mat_anexo_1/OEBPS/relatorio.xhtml">Material Anexo 1</a>'
    : "";
  const xhtml = `<html><head><title>${params.titulo}</title></head><body><h1>${params.titulo}</h1><img src="midias/foto_1.webp" /><video id="video-v1" src="midias/video_1.mp4" poster="midias/video_1_poster.jpg"></video>${linkMaterial}</body></html>`;
  const css = "body { font-family: sans-serif; }";
  const foto = new Uint8Array([10, 20, 30, 40]);
  const video = construirMp4ComAtomosStssTeste([1, 301]);
  const posterVideo = new Uint8Array([11, 22, 33]);
  const keyframeVideo = new Uint8Array([44, 55, 66]);
  const xhtmlMatAnexo = encoder.encode(
    "<html><body><h2>Ficha Técnica Parabolt Inox</h2></body></html>",
  );

  const fotosExtras: Array<{ nome: string; dados: Uint8Array; digest: string }> = [];
  for (let i = 0; i < (params.quantidadeFotosExtras ?? 0); i++) {
    const dadosExtra = new Uint8Array([10 + i, 20 + i, 30 + i, 40 + i]);
    fotosExtras.push({
      nome: `OEBPS/midias/foto_extra_${i + 2}.webp`,
      dados: dadosExtra,
      digest: await calcularSha256Base64(dadosExtra),
    });
  }

  const xhtmlBytesDescomprimidos = encoder.encode(xhtml);
  const cssBytesDescomprimidos = encoder.encode(css);
  const digestXhtml = await calcularSha256Base64(xhtmlBytesDescomprimidos);
  const digestCss = await calcularSha256Base64(cssBytesDescomprimidos);
  const digestFoto = await calcularSha256Base64(foto);
  const digestVideo = await calcularSha256Base64(video);
  const digestPoster = await calcularSha256Base64(posterVideo);
  const digestKeyframe = await calcularSha256Base64(keyframeVideo);
  const digestMatAnexo = await calcularSha256Base64(xhtmlMatAnexo);

  const signaturesXml = `<?xml version="1.0" encoding="UTF-8"?>
<signatures xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <Reference URI="OEBPS/relatorio.xhtml"><DigestValue>${digestXhtml}</DigestValue></Reference>
      <Reference URI="OEBPS/estilo.css"><DigestValue>${digestCss}</DigestValue></Reference>
      <Reference URI="OEBPS/midias/foto_1.webp"><DigestValue>${digestFoto}</DigestValue></Reference>
      ${fotosExtras
        .map(
          (f) =>
            `<Reference URI="${f.nome}"><DigestValue>${f.digest}</DigestValue></Reference>`,
        )
        .join("\n      ")}
      ${
        params.incluirVideo
          ? `<Reference URI="OEBPS/midias/video_1.mp4"><DigestValue>${digestVideo}</DigestValue></Reference>
      <Reference URI="OEBPS/midias/video_1_poster.jpg"><DigestValue>${digestPoster}</DigestValue></Reference>
      <Reference URI="OEBPS/midias/video_1_kf_10s.jpg"><DigestValue>${digestKeyframe}</DigestValue></Reference>`
          : ""
      }
      ${
        params.incluirMaterialAnexo
          ? `<Reference URI="OEBPS/materiais/mat_anexo_1/OEBPS/relatorio.xhtml"><DigestValue>${digestMatAnexo}</DigestValue></Reference>`
          : ""
      }
    </SignedInfo>
    <SignatureValue>Y2hhdmVfYXNzaW5hdHVyYV9lY2RzYV92YWxpZGFfMTIzNDU2</SignatureValue>
    <KeyInfo><X509Data><X509Certificate>TUVVX0NFUlRfVEVTVEU=</X509Certificate></KeyInfo>
    <Object Id="oidc-attestation"><OidcIdToken>${params.atestadoOidcJwt}</OidcIdToken></Object>
  </Signature>
</signatures>`;

  const xhtmlArmazenado = params.comprimirXhtmlComDeflate
    ? await comprimirDeflateRaw(xhtmlBytesDescomprimidos)
    : xhtmlBytesDescomprimidos;
  const cssArmazenado = params.comprimirXhtmlComDeflate
    ? await comprimirDeflateRaw(cssBytesDescomprimidos)
    : cssBytesDescomprimidos;
  const metodoTexto = params.comprimirXhtmlComDeflate ? 8 : 0;

  const entradas = [
    { nome: "OEBPS/relatorio.xhtml", dados: xhtmlArmazenado, metodo: metodoTexto },
    { nome: "OEBPS/estilo.css", dados: cssArmazenado, metodo: metodoTexto },
    { nome: "OEBPS/midias/foto_1.webp", dados: foto },
    ...fotosExtras.map((f) => ({ nome: f.nome, dados: f.dados })),
    ...(params.incluirVideo
      ? [
          { nome: "OEBPS/midias/video_1.mp4", dados: video },
          { nome: "OEBPS/midias/video_1_poster.jpg", dados: posterVideo },
          { nome: "OEBPS/midias/video_1_kf_10s.jpg", dados: keyframeVideo },
        ]
      : []),
    ...(params.incluirMaterialAnexo
      ? [
          {
            nome: "OEBPS/materiais/mat_anexo_1/OEBPS/relatorio.xhtml",
            dados: xhtmlMatAnexo,
          },
        ]
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
    incluirMaterialAnexo: true,
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

  // Reenviar exatamente o mesmo EPUB (mesmo sha256) deve retornar 200 ja_enviado: true sem criar v2
  const resUploadDuplicado = await workerDefault.fetch(
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
  );
  assertEquals(resUploadDuplicado.status, 200);
  const jsonDuplicado = await resUploadDuplicado.json();
  assertEquals(jsonDuplicado.versao, 1);
  assertEquals(jsonDuplicado.ja_enviado, true);

  // 4. Upload v2 pelo mesmo usuário (com XHTML/CSS comprimidos com DEFLATE) -> cria versão imutável v2
  const epubV2 = await criarEpubAssinadoTeste({
    titulo: "Via Aresta — v2 Atualizada",
    atestadoOidcJwt: tokens.atestadoOidcJwt,
    incluirVideo: true,
    incluirMaterialAnexo: true,
    comprimirXhtmlComDeflate: true,
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

  // 6. Visualização pública de GET /v/sessao_aresta (v2 padrão e ?v=1) e cache de borda
  const resPaginaV2 = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta"),
    env,
  );
  assertEquals(resPaginaV2.status, 200);
  assertEquals(
    resPaginaV2.headers.get("Cache-Control")?.includes("max-age=31536000"),
    true,
  );
  const htmlV2 = await resPaginaV2.text();
  assertEquals(htmlV2.includes("Via Aresta — v2 Atualizada"), true);
  assertEquals(htmlV2.includes("1 laudo(s) assinado(s) por esta chave"), true);
  assertEquals(htmlV2.includes('href="/v/sessao_aresta?v=1"'), true);
  assertEquals(htmlV2.includes('property="og:title"'), true);
  assertEquals(htmlV2.includes("Ficha Técnica Parabolt Inox"), true);

  // Segunda abertura serve diretamente do cache de borda
  const hitsAntes = env.cacheBorda.leiturasHit;
  const resPaginaV2Cache = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta"),
    env,
  );
  assertEquals(resPaginaV2Cache.status, 200);
  assertEquals(env.cacheBorda.leiturasHit, hitsAntes + 1);

  const resPaginaV1 = await workerDefault.fetch(
    new Request("https://fixalog.app/v/sessao_aresta?v=1"),
    env,
  );
  assertEquals(resPaginaV1.status, 200);
  assertEquals((await resPaginaV1.text()).includes("Via Aresta — v1"), true);

  // 7. Streaming Byte-Range 206 Partial Content de mídia e rota interna GET /__csam_scan/*
  const resMidia206 = await workerDefault.fetch(
    new Request(
      "https://fixalog.app/v/sessao_aresta/midias/OEBPS/midias/foto_1.webp?v=2",
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

  const tokenHmacScan = await gerarTokenHmacCsamScan({
    idSessao: "sessao_aresta",
    versao: 2,
    caminho: "OEBPS/midias/foto_1.webp",
    segredo: env.SENTRY_DSN,
  });
  const resCsamScanOk = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/__csam_scan/sessao_aresta/v2/OEBPS/midias/foto_1.webp?token=${tokenHmacScan}`,
    ),
    env,
  );
  assertEquals(resCsamScanOk.status, 200);
  assertEquals(resCsamScanOk.headers.get("Content-Type"), "image/webp");
  assertEquals(
    Array.from(new Uint8Array(await resCsamScanOk.arrayBuffer())),
    [10, 20, 30, 40],
  );

  const resCsamScanNegado = await workerDefault.fetch(
    new Request(
      "https://fixalog.app/__csam_scan/sessao_aresta/v2/OEBPS/midias/foto_1.webp?token=invalido",
    ),
    env,
  );
  assertEquals(resCsamScanNegado.status, 403);

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

Deno.test("fixalog-worker: upload retomável em blocos (GET /status e PUT /chunk) e idempotência por {id_sessao, sha256}", async () => {
  const env = new AmbienteFixalogFake();
  const tokens = await construirTokensAssinadosTeste({
    userId: "usr_montanha",
    nome: "Escalador Montanha",
  });

  const epub = await criarEpubAssinadoTeste({
    titulo: "Via Dedo de Deus — Retomável",
    atestadoOidcJwt: tokens.atestadoOidcJwt,
    incluirVideo: false,
  });
  const sha256 = await calcularSha256Hex(epub);
  const metade = Math.ceil(epub.byteLength / 2);
  const chunk0 = epub.slice(0, metade);
  const chunk1 = epub.slice(metade);

  // 1. Consulta inicial antes de qualquer envio
  const resStatus0 = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_retomavel/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokens.jwtSupabase}`,
        },
      },
    ),
    env,
  );
  assertEquals(resStatus0.status, 200);
  const status0 = await resStatus0.json();
  assertEquals(status0.ja_enviado, false);
  assertEquals(status0.chunks_recebidos, []);

  // 2. Envia chunk 0 de 2 (simula queda de rede antes do chunk 1)
  const resChunk0 = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_retomavel/chunk?sha256=${sha256}&index=0&total=2`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokens.jwtSupabase}`,
        },
        body: chunk0 as unknown as BodyInit,
      },
    ),
    env,
  );
  assertEquals(resChunk0.status, 200);
  const jsonChunk0 = await resChunk0.json();
  assertEquals(jsonChunk0.finalizado, false);
  assertEquals(jsonChunk0.chunks_recebidos, [0]);

  // 3. Ao retomar conexão, consulta status e descobre que chunk 0 já está salvo
  const resStatusParcial = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_retomavel/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokens.jwtSupabase}`,
        },
      },
    ),
    env,
  );
  const statusParcial = await resStatusParcial.json();
  assertEquals(statusParcial.ja_enviado, false);
  assertEquals(statusParcial.chunks_recebidos, [0]);

  // 4. Envia apenas o chunk 1 restante -> Worker concatena, valida assinatura e cria v1
  const resChunk1 = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_retomavel/chunk?sha256=${sha256}&index=1&total=2`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokens.jwtSupabase}`,
        },
        body: chunk1 as unknown as BodyInit,
      },
    ),
    env,
    env.contexto,
  );
  assertEquals(resChunk1.status, 201);
  const jsonChunk1 = await resChunk1.json();
  assertEquals(jsonChunk1.finalizado, true);
  assertEquals(jsonChunk1.versao, 1);
  assertEquals(jsonChunk1.status_moderacao, "em_analise");

  // Conclui moderação em background -> promove para 'ativo'
  await env.aguardarTarefasBackground();

  // 5. Consulta status após conclusão -> ja_enviado: true, status_moderacao: 'ativo'
  const resStatusFinal = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_retomavel/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokens.jwtSupabase}`,
        },
      },
    ),
    env,
  );
  const statusFinal = await resStatusFinal.json();
  assertEquals(statusFinal.ja_enviado, true);
  assertEquals(statusFinal.versao, 1);
  assertEquals(statusFinal.status_moderacao, "ativo");

  // 6. Tentar enviar chunk novamente para o mesmo sha256 retorna 200 ja_enviado: true sem recriar
  const resChunkDuplicado = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_retomavel/chunk?sha256=${sha256}&index=0&total=2`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokens.jwtSupabase}`,
        },
        body: chunk0 as unknown as BodyInit,
      },
    ),
    env,
  );
  assertEquals(resChunkDuplicado.status, 200);
  const jsonChunkDup = await resChunkDuplicado.json();
  assertEquals(jsonChunkDup.ja_enviado, true);
  assertEquals(jsonChunkDup.versao, 1);
});

Deno.test("fixalog-worker: restringe GET /status ao proprietário (403), retorna progresso de verificação, limpa staging em erro 400 e expira staging > 14 dias via Cron", async () => {
  const env = new AmbienteFixalogFake();
  const tokensDono = await construirTokensAssinadosTeste({
    userId: "usr_dono",
    nome: "Autor Original",
  });
  const tokensTerceiro = await construirTokensAssinadosTeste({
    userId: "usr_terceiro",
    nome: "Outro Usuário",
  });

  const epub = await criarEpubAssinadoTeste({
    titulo: "Via Corcovado",
    atestadoOidcJwt: tokensDono.atestadoOidcJwt,
    incluirVideo: true,
  });
  const sha256 = await calcularSha256Hex(epub);

  // 1. Faz upload do laudo como usr_dono sem aguardar background ainda
  const resUpload = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_segura", {
      method: "PUT",
      headers: {
        "Content-Type": "application/epub+zip",
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokensDono.jwtSupabase}`,
      },
      body: epub as unknown as BodyInit,
    }),
    env,
    env.contexto,
  );
  assertEquals(resUpload.status, 201);

  // 2. Outro usuário autenticado tentando consultar GET /status recebe 403 Forbidden
  const resStatusTerceiro = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_segura/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensTerceiro.jwtSupabase}`,
        },
      },
    ),
    env,
  );
  assertEquals(resStatusTerceiro.status, 403);

  // 3. Conclui moderação e verifica que o dono recebe verificacao_concluida e verificacao_total
  await env.aguardarTarefasBackground();
  const resStatusDono = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_segura/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensDono.jwtSupabase}`,
        },
      },
    ),
    env,
  );
  assertEquals(resStatusDono.status, 200);
  const jsonStatusDono = await resStatusDono.json();
  assertEquals(jsonStatusDono.status_moderacao, "ativo");
  assertEquals(typeof jsonStatusDono.verificacao_concluida, "number");
  assertEquals(typeof jsonStatusDono.verificacao_total, "number");
  assertEquals(jsonStatusDono.verificacao_concluida > 0, true);
  assertEquals(
    jsonStatusDono.verificacao_concluida,
    jsonStatusDono.verificacao_total,
  );

  // 4. Quando o último chunk falha na validação (ex.: SHA-256 ou assinatura inválida), os chunks de staging são removidos imediatamente do R2
  const bytesInvalidos = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const shaInvalido = await calcularSha256Hex(bytesInvalidos);
  const resChunkInvalido = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_invalida/chunk?sha256=${shaInvalido}&index=0&total=1`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensDono.jwtSupabase}`,
        },
        body: bytesInvalidos as unknown as BodyInit,
      },
    ),
    env,
  );
  assertEquals(resChunkInvalido.status, 400);
  const listagemAposErro = await env.LAUDOS_BUCKET.list({
    prefix: `staging/sessao_invalida/${shaInvalido}/`,
  });
  assertEquals(listagemAposErro.objects.length, 0);

  // 5. Cron Trigger (scheduled) limpa chunks órfãos em staging/ com > 7 dias e preserva os com < 7 dias
  const agoraMs = Date.parse("2026-11-25T04:00:00Z");
  const oitoDiasAtras = new Date(agoraMs - 8 * 24 * 60 * 60 * 1000);
  const cincoDiasAtras = new Date(agoraMs - 5 * 24 * 60 * 60 * 1000);

  await env.LAUDOS_BUCKET.put(
    "staging/sessao_antiga/abc/chunk_0",
    new Uint8Array([1, 2]),
  );
  env.LAUDOS_BUCKET.definirDataUpload(
    "staging/sessao_antiga/abc/chunk_0",
    oitoDiasAtras,
  );

  await env.LAUDOS_BUCKET.put(
    "staging/sessao_expedicao_5dias/def/chunk_0",
    new Uint8Array([3, 4]),
  );
  env.LAUDOS_BUCKET.definirDataUpload(
    "staging/sessao_expedicao_5dias/def/chunk_0",
    cincoDiasAtras,
  );

  await workerDefault.scheduled!(
    { scheduledTime: agoraMs, cron: "0 4 * * *" },
    env,
    env.contexto,
  );
  await env.aguardarTarefasBackground();

  assertEquals(
    await env.LAUDOS_BUCKET.get("staging/sessao_antiga/abc/chunk_0"),
    null,
  );
  assertEquals(
    (
      await env.LAUDOS_BUCKET.get(
        "staging/sessao_expedicao_5dias/def/chunk_0",
      )
    ) !== null,
    true,
  );

  // 6. SEO: GET /robots.txt e GET /sitemap.xml
  const resRobots = await workerDefault.fetch(
    new Request("https://fixalog.app/robots.txt"),
    env,
  );
  assertEquals(resRobots.status, 200);
  const textoRobots = await resRobots.text();
  assertEquals(textoRobots.includes("Sitemap: https://fixalog.app/sitemap.xml"), true);
  assertEquals(textoRobots.includes("Disallow: /__csam_scan/"), true);

  const resSitemap = await workerDefault.fetch(
    new Request("https://fixalog.app/sitemap.xml"),
    env,
  );
  assertEquals(resSitemap.status, 200);
  const textoSitemap = await resSitemap.text();
  assertEquals(
    textoSitemap.includes("<loc>https://fixalog.app/v/sessao_segura</loc>"),
    true,
  );

  // 7. Exclusão pelo proprietário: DELETE /api/v1/laudos/:id
  const resDeleteTerceiro = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_segura", {
      method: "DELETE",
      headers: {
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokensTerceiro.jwtSupabase}`,
      },
    }),
    env,
  );
  assertEquals(resDeleteTerceiro.status, 403);

  const resDeleteDono = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_segura", {
      method: "DELETE",
      headers: {
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokensDono.jwtSupabase}`,
      },
    }),
    env,
  );
  assertEquals(resDeleteDono.status, 200);
  assertEquals(await env.LAUDOS_BUCKET.get("laudos/sessao_segura/v1.epub"), null);
});

Deno.test("fixalog-worker: reprocessa automaticamente laudo já enviado no R2 quando tentativa anterior falhou por ERRO_TECNICO_VERIFICACAO sem exigir novo upload", async () => {
  const env = new AmbienteFixalogFake();
  const tokensDono = await construirTokensAssinadosTeste({
    userId: "usr_retentativa",
    nome: "Renato Utsch",
  });

  const epub = await criarEpubAssinadoTeste({
    titulo: "Barras Roscadas",
    atestadoOidcJwt: tokensDono.atestadoOidcJwt,
  });
  const sha256 = await calcularSha256Hex(epub);

  // 1. Primeiro upload falha na verificação por erro técnico (HTTP 522 simulado)
  env.statusSubrequisicaoCsam = 522;
  const resUpload = await workerDefault.fetch(
    new Request("https://fixalog.app/api/v1/laudos/sessao_erro_tecnico", {
      method: "PUT",
      headers: {
        "Content-Type": "application/epub+zip",
        "X-Firebase-AppCheck": "app_check_valido_123",
        Authorization: `Bearer ${tokensDono.jwtSupabase}`,
      },
      body: epub as unknown as BodyInit,
    }),
    env,
    env.contexto,
  );
  assertEquals(resUpload.status, 201);
  await env.aguardarTarefasBackground();

  // O primeiro GET /status logo após a falha reporta o erro técnico ao cliente
  const resStatusFalha = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_erro_tecnico/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensDono.jwtSupabase}`,
        },
      },
    ),
    env,
    env.contexto,
  );
  assertEquals(resStatusFalha.status, 200);
  const jsonFalha = await resStatusFalha.json();
  assertEquals(jsonFalha.ja_enviado, true);
  assertEquals(jsonFalha.status_moderacao, "bloqueado");
  assertEquals(
    String(jsonFalha.motivo_moderacao).startsWith(
      "ERRO_TECNICO_VERIFICACAO:CSAM_SCAN_HTTP_522",
    ),
    true,
  );

  // 2. Quando o problema técnico é sanado e o usuário toca em COMPARTILHAR novamente,
  // a consulta a GET /status retoma automaticamente a verificação a partir do R2 sem re-upload!
  env.statusSubrequisicaoCsam = 200;
  const resStatusRetomada = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_erro_tecnico/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensDono.jwtSupabase}`,
        },
      },
    ),
    env,
    env.contexto,
  );
  assertEquals(resStatusRetomada.status, 200);
  const jsonRetomada = await resStatusRetomada.json();
  assertEquals(jsonRetomada.ja_enviado, true);
  assertEquals(jsonRetomada.status_moderacao, "em_analise");
  assertEquals(jsonRetomada.motivo_moderacao, null);

  await env.aguardarTarefasBackground();

  const resStatusFinal = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_erro_tecnico/status?sha256=${sha256}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensDono.jwtSupabase}`,
        },
      },
    ),
    env,
    env.contexto,
  );
  assertEquals(resStatusFinal.status, 200);
  const jsonFinal = await resStatusFinal.json();
  assertEquals(jsonFinal.ja_enviado, true);
  assertEquals(jsonFinal.status_moderacao, "ativo");
  assertEquals(jsonFinal.motivo_moderacao, null);

  // 3. Se uma versão ficar parada em "em_analise" (ex.: limite de 30s do ctx.waitUntil após 2 de 3 mídias),
  // o próximo GET /status retoma automaticamente da etapa 2 (processando apenas a 3ª mídia restante)
  const epubTresMidias = await criarEpubAssinadoTeste({
    titulo: "Barras Roscadas 316",
    atestadoOidcJwt: tokensDono.atestadoOidcJwt,
    incluirVideo: true,
  });
  const shaTresMidias = await calcularSha256Hex(epubTresMidias);
  await env.LAUDOS_BUCKET.put(
    "laudos/sessao_parada_10_15/v1.epub",
    epubTresMidias,
  );
  const agoraIso = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO laudos_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_parada_10_15",
      "usr_retentativa",
      "MATERIAL",
      " Anchor Bolts",
      "Barras Roscadas 316",
      null,
      null,
      null,
      1,
      agoraIso,
      agoraIso,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog (id_sessao, versao, r2_key, tamanho_bytes, hash_epub_sha256, fingerprint_chave, nome_mantenedor, clube_mantenedor, indices_zip_json, materiais_referenciados_json, status_moderacao, motivo_moderacao, verificacao_concluida, verificacao_total, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_parada_10_15",
      1,
      "laudos/sessao_parada_10_15/v1.epub",
      epubTresMidias.byteLength,
      shaTresMidias,
      "fp",
      "Renato Utsch",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      2,
      3,
      agoraIso,
    )
    .run();

  const chamadasIaAntes = env.AI.chamadas.length;
  const resStatusParada = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_parada_10_15/status?sha256=${shaTresMidias}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensDono.jwtSupabase}`,
        },
      },
    ),
    env,
    env.contexto,
  );
  assertEquals(resStatusParada.status, 200);
  await env.aguardarTarefasBackground();

  // Deve ter inspecionado apenas a 1 mídia restante (3 - 2 = 1 chamada à IA)
  assertEquals(env.AI.chamadas.length - chamadasIaAntes, 1);

  const resStatusDesbloqueada = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_parada_10_15/status?sha256=${shaTresMidias}`,
      {
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokensDono.jwtSupabase}`,
        },
      },
    ),
    env,
    env.contexto,
  );
  const jsonDesbloqueada = await resStatusDesbloqueada.json();
  assertEquals(jsonDesbloqueada.status_moderacao, "ativo");
  assertEquals(jsonDesbloqueada.verificacao_concluida, 3);
  assertEquals(jsonDesbloqueada.verificacao_total, 3);

  // 4. Mesmo que o aplicativo seja fechado (sem chamadas GET /status), o Cron Trigger ("* * * * *")
  // retoma e conclui em background qualquer versão parada em "em_analise" no D1
  await env.LAUDOS_BUCKET.put(
    "laudos/sessao_cron_bg/v1.epub",
    epubTresMidias,
  );
  await env.DB.prepare(
    "INSERT INTO laudos_fixalog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_cron_bg",
      "usr_retentativa",
      "MATERIAL",
      "Anchor Bolts",
      "Barras Roscadas Cron",
      null,
      null,
      null,
      1,
      agoraIso,
      agoraIso,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO versoes_laudo_fixalog (id_sessao, versao, r2_key, tamanho_bytes, hash_epub_sha256, fingerprint_chave, nome_mantenedor, clube_mantenedor, indices_zip_json, materiais_referenciados_json, status_moderacao, motivo_moderacao, verificacao_concluida, verificacao_total, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "sessao_cron_bg",
      1,
      "laudos/sessao_cron_bg/v1.epub",
      epubTresMidias.byteLength,
      shaTresMidias,
      "fp",
      "Renato Utsch",
      "FEMERJ",
      "{}",
      "[]",
      "em_analise",
      null,
      1,
      3,
      agoraIso,
    )
    .run();

  await workerDefault.scheduled!(
    { scheduledTime: Date.now(), cron: "* * * * *" },
    env,
    env.contexto,
  );
  await env.aguardarTarefasBackground();

  const versaoAposCron = await env.DB.prepare(
    "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
  )
    .bind("sessao_cron_bg", 1)
    .first<{
      status_moderacao: string;
      verificacao_concluida: number;
      verificacao_total: number;
    }>();
  assertEquals(versaoAposCron?.status_moderacao, "ativo");
  assertEquals(versaoAposCron?.verificacao_concluida, 3);
  assertEquals(versaoAposCron?.verificacao_total, 3);
});

Deno.test("index: auto-encadeia lotes curtos via Service Binding env.SELF em POST /__internal/moderar com retentativa automática e rejeita token inválido com 403", async () => {
  const env = new AmbienteFixalogFake();
  const urlsInternasAcionadas: string[] = [];

  // Conecta o Service Binding SELF de volta ao próprio Worker
  env.SELF = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const reqInterna =
        input instanceof Request
          ? input
          : new Request(input.toString(), init);
      urlsInternasAcionadas.push(reqInterna.url);
      return await workerDefault.fetch(reqInterna, env, env.contexto);
    },
  };

  // 1. Chamada externa sem token HMAC válido na rota /__internal/moderar deve retornar 403
  const resSemToken = await workerDefault.fetch(
    new Request("https://fixalog.app/__internal/moderar/sessao_x/v1?token=invalido", {
      method: "POST",
    }),
    env,
    env.contexto,
  );
  assertEquals(resSemToken.status, 403);

  // 2. Upload de laudo com 7 imagens dispara auto-encadeamento em lotes de 3 imagens via env.SELF
  // e se recupera de 1 falha transitória da IA no meio do caminho sem intervenção do cliente
  const tokens = await construirTokensAssinadosTeste({
    userId: "usr_self_chain",
    nome: "Renato Utsch",
  });
  const epub7Midias = await criarEpubAssinadoTeste({
    titulo: "Laudo 7 Imagens Auto-Chaining",
    atestadoOidcJwt: tokens.atestadoOidcJwt,
    quantidadeFotosExtras: 6,
  });
  const sha7Midias = await calcularSha256Hex(epub7Midias);

  // Simula 1 falha transitória na 4ª imagem (início do 2º lote), que deve ser retentada automaticamente
  let chamadasIa = 0;
  const runOriginal = env.AI.run.bind(env.AI);
  env.AI.run = async (modelo: string, entrada: Record<string, unknown>) => {
    chamadasIa++;
    if (chamadasIa === 4) {
      throw new Error("Timeout transitório no Workers AI.");
    }
    return await runOriginal(modelo, entrada);
  };

  const resChunk = await workerDefault.fetch(
    new Request(
      `https://fixalog.app/api/v1/laudos/sessao_self_7/chunk?sha256=${sha7Midias}&index=0&total=1`,
      {
        method: "PUT",
        headers: {
          "X-Firebase-AppCheck": "app_check_valido_123",
          Authorization: `Bearer ${tokens.jwtSupabase}`,
        },
        body: new Uint8Array(epub7Midias),
      },
    ),
    env,
    env.contexto,
  );
  assertEquals(resChunk.status, 201);

  // Aguarda toda a cadeia de chamadas assíncronas via waitUntil(env.SELF.fetch(...))
  await env.aguardarTarefasBackground();

  // Deve ter encadeado múltiplos lotes via /__internal/moderar (etapa=0, etapa=3 tentativa=1, etapa=3 tentativa=2, etapa=6)
  assertEquals(urlsInternasAcionadas.length >= 4, true);
  assertEquals(
    urlsInternasAcionadas.some((u) => u.includes("tentativa=2")),
    true,
  );

  const versaoFinal = await env.DB.prepare(
    "SELECT * FROM versoes_laudo_fixalog WHERE id_sessao = ? AND versao = ?",
  )
    .bind("sessao_self_7", 1)
    .first<{
      status_moderacao: string;
      verificacao_concluida: number;
      verificacao_total: number;
    }>();
  assertEquals(versaoFinal?.status_moderacao, "ativo");
  assertEquals(versaoFinal?.verificacao_concluida, 7);
  assertEquals(versaoFinal?.verificacao_total, 7);
});
