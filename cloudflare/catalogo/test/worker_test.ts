// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import workerDefault, {
  CABECALHO_CACHE_IMUTAVEL,
  condensarDeltas,
  processarRequisicao,
  RegistroDeltaD1,
} from "../src/index.ts";

function criarMockD1(
  respostasPorQuery: (sql: string, params: unknown[]) => unknown[]
) {
  return {
    prepare(sql: string) {
      let parametrosVinculados: unknown[] = [];
      return {
        bind(...params: unknown[]) {
          parametrosVinculados = params;
          return this;
        },
        async all<T = Record<string, unknown>>() {
          const results = respostasPorQuery(sql, parametrosVinculados) as T[];
          return { results };
        },
      };
    },
  };
}

Deno.test("catalogo-gateway: responde a OPTIONS com status 204 e cabecalhos CORS", async () => {
  const req = new Request("https://catalogo.arestaclimb.com/sync", {
    method: "OPTIONS",
  });
  const res = await processarRequisicao(req);

  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("catalogo-gateway: rejeita metodos POST, PUT e DELETE com 405", async () => {
  for (const metodo of ["POST", "PUT", "DELETE"]) {
    const req = new Request("https://catalogo.arestaclimb.com/sync", {
      method: metodo,
    });
    const res = await processarRequisicao(req);

    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET, HEAD, OPTIONS");
  }
});

Deno.test("catalogo-gateway: rota de healthcheck (/ e /health) retorna 200 operacional", async () => {
  for (const path of ["/", "/health"]) {
    const req = new Request(`https://catalogo.arestaclimb.com${path}`);
    const res = await workerDefault.fetch(req, {});

    assertEquals(res.status, 200);
    const texto = await res.text();
    assertEquals(texto.includes("operacional"), true);
  }
});

Deno.test("catalogo-gateway: /sync sem parametros obrigatorios retorna 400 com no-store", async () => {
  const req = new Request("https://catalogo.arestaclimb.com/sync?versao_local=abc");
  const res = await processarRequisicao(req);

  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const corpo = await res.json();
  assertEquals(
    corpo.erro,
    "Parâmetros versao_local e versao_destino são obrigatórios"
  );
});

Deno.test("catalogo-gateway: /sync com versao_local igual a versao_destino retorna delta vazio imutavel sem consultar D1", async () => {
  const req = new Request(
    "https://catalogo.arestaclimb.com/sync?versao_local=8f5027d0f987d808&versao_destino=8f5027d0f987d808"
  );
  const res = await processarRequisicao(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), CABECALHO_CACHE_IMUTAVEL);
  const corpo = await res.json();
  assertEquals(corpo, {
    acao: "apply_delta",
    versao_atual: "8f5027d0f987d808",
    total_deltas: 0,
    upserts: { croquis: [], vias: [] },
    deletes: { croquis: [], vias: [] },
  });
});

Deno.test("catalogo-gateway: /sync retorna 500 se binding DB nao estiver configurado", async () => {
  const req = new Request(
    "https://catalogo.arestaclimb.com/sync?versao_local=aaaa&versao_destino=bbbb"
  );
  const res = await processarRequisicao(req, {});

  assertEquals(res.status, 500);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("catalogo-gateway: /sync retorna full_download com no-store quando versao_local nao existe no D1", async () => {
  const dbMock = criarMockD1((sql, _params) => {
    if (sql.includes("WHERE versao_hash IN")) {
      // Apenas a versao_destino foi encontrada no banco D1
      return [{ id: 10, versao_hash: "hash_destino_10" }];
    }
    return [];
  });

  const req = new Request(
    "https://catalogo.arestaclimb.com/sync?versao_local=hash_inexistente&versao_destino=hash_destino_10"
  );
  const res = await processarRequisicao(req, { DB: dbMock });

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const corpo = await res.json();
  assertEquals(corpo, {
    acao: "full_download",
    versao_atual: "hash_destino_10",
  });
});

Deno.test("catalogo-gateway: /sync retorna full_download quando id_local e maior que id_destino", async () => {
  const dbMock = criarMockD1((sql, _params) => {
    if (sql.includes("WHERE versao_hash IN")) {
      return [
        { id: 15, versao_hash: "hash_local_futuro" },
        { id: 10, versao_hash: "hash_destino_antigo" },
      ];
    }
    return [];
  });

  const req = new Request(
    "https://catalogo.arestaclimb.com/sync?versao_local=hash_local_futuro&versao_destino=hash_destino_antigo"
  );
  const res = await processarRequisicao(req, { DB: dbMock });

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const corpo = await res.json();
  assertEquals(corpo.acao, "full_download");
});

Deno.test("catalogo-gateway: /sync realiza Delta Squash entre multiplas versoes e retorna Cache-Control imutavel", async () => {
  const deltasNoBanco: RegistroDeltaD1[] = [
    {
      id: 2,
      versao_hash: "v_intermediaria",
      upserts_json: JSON.stringify({
        croquis: [
          {
            croqui_uid: "c1",
            id_slug: "br_mg_bh_1",
            nome: "Pico 1",
            cidade: "BH",
            uf: "MG",
          },
          {
            croqui_uid: "c_temp",
            id_slug: "br_mg_temp",
            nome: "Temporario",
            cidade: "BH",
            uf: "MG",
          },
        ],
        vias: [
          {
            uid: "v1",
            croqui_uid: "c1",
            nome: "Via 1 Versao Antiga",
            grau: "6sup",
            tipo: "esportiva",
            setor_nome: "S1",
            setor_uid: "s1",
          },
          {
            uid: "v2",
            croqui_uid: "c1",
            nome: "Via 2 Sera Deletada",
            grau: "7a",
            tipo: "esportiva",
            setor_nome: "S1",
            setor_uid: "s1",
          },
        ],
      }),
      deletes_json: JSON.stringify({
        croquis: ["c_recriado"],
        vias: ["v_antiga_removida", "v_recriada"],
      }),
    },
    {
      id: 3,
      versao_hash: "v_destino",
      upserts_json: JSON.stringify({
        croquis: [
          {
            croqui_uid: "c1",
            id_slug: "br_mg_bh_1",
            nome: "Pico 1 Atualizado",
            cidade: "BH",
            uf: "MG",
          },
          {
            croqui_uid: "c_recriado",
            id_slug: "br_mg_rec",
            nome: "Pico Recriado",
            cidade: "BH",
            uf: "MG",
          },
        ],
        vias: [
          {
            uid: "v1",
            croqui_uid: "c1",
            nome: "Via 1 Versao Final",
            grau: "7b",
            tipo: "esportiva",
            setor_nome: "S1",
            setor_uid: "s1",
          },
          {
            uid: "v_recriada",
            croqui_uid: "c1",
            nome: "Via Recriada",
            grau: "8a",
            tipo: "esportiva",
            setor_nome: "S1",
            setor_uid: "s1",
          },
        ],
      }),
      deletes_json: JSON.stringify({
        croquis: ["c_temp"],
        vias: ["v2"],
      }),
    },
  ];

  const dbMock = criarMockD1((sql, _params) => {
    if (sql.includes("WHERE versao_hash IN")) {
      return [
        { id: 1, versao_hash: "v_local" },
        { id: 3, versao_hash: "v_destino" },
      ];
    }
    if (sql.includes("WHERE id > ? AND id <= ?")) {
      return deltasNoBanco;
    }
    return [];
  });

  const req = new Request(
    "https://catalogo.arestaclimb.com/sync?versao_local=v_local&versao_destino=v_destino"
  );
  const res = await processarRequisicao(req, { DB: dbMock });

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), CABECALHO_CACHE_IMUTAVEL);

  const corpo = await res.json();
  assertEquals(corpo.acao, "apply_delta");
  assertEquals(corpo.versao_atual, "v_destino");
  assertEquals(corpo.total_deltas, 2);

  // c1 foi atualizado na versão 3 e c_recriado foi recriado; c_temp foi deletado
  assertEquals(corpo.upserts.croquis, [
    {
      croqui_uid: "c1",
      id_slug: "br_mg_bh_1",
      nome: "Pico 1 Atualizado",
      cidade: "BH",
      uf: "MG",
    },
    {
      croqui_uid: "c_recriado",
      id_slug: "br_mg_rec",
      nome: "Pico Recriado",
      cidade: "BH",
      uf: "MG",
    },
  ]);
  assertEquals(corpo.deletes.croquis, ["c_temp"]);

  // v1 ficou com a versão final (7b), v_recriada entrou em upserts e saiu de deletes; v2 foi deletada
  assertEquals(corpo.upserts.vias, [
    {
      uid: "v1",
      croqui_uid: "c1",
      nome: "Via 1 Versao Final",
      grau: "7b",
      tipo: "esportiva",
      setor_nome: "S1",
      setor_uid: "s1",
    },
    {
      uid: "v_recriada",
      croqui_uid: "c1",
      nome: "Via Recriada",
      grau: "8a",
      tipo: "esportiva",
      setor_nome: "S1",
      setor_uid: "s1",
    },
  ]);
  assertEquals(corpo.deletes.vias, ["v_antiga_removida", "v2"]);
});

Deno.test("catalogo-gateway: condensarDeltas lida com JSON sem chaves opcionais", () => {
  const resultado = condensarDeltas([
    {
      id: 1,
      versao_hash: "h1",
      upserts_json: "{}",
      deletes_json: "{}",
    },
  ]);
  assertEquals(resultado, {
    upserts: { croquis: [], vias: [] },
    deletes: { croquis: [], vias: [] },
  });
});

Deno.test("catalogo-gateway: /sync retorna 500 com no-store se query ao D1 lancar excecao", async () => {
  const dbComFalha = {
    prepare(_sql: string) {
      return {
        bind(..._params: unknown[]) {
          return this;
        },
        all() {
          return Promise.reject(new Error("D1 indisponivel"));
        },
      };
    },
  };

  const req = new Request(
    "https://catalogo.arestaclimb.com/sync?versao_local=v1&versao_destino=v2"
  );
  const res = await processarRequisicao(req, { DB: dbComFalha });

  assertEquals(res.status, 500);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const corpo = await res.json();
  assertEquals(corpo.erro.includes("Erro ao consultar deltas"), true);
});

Deno.test("catalogo-gateway: retorna 404 para rotas desconhecidas", async () => {
  const req = new Request("https://catalogo.arestaclimb.com/rota-inexistente");
  const res = await processarRequisicao(req);

  assertEquals(res.status, 404);
});
