# Aresta Catálogo Gateway (`catalogo.arestaclimb.com`)

Worker em borda (Cloudflare Worker + Cloudflare D1) responsável por fornecer deltas incrementais condensados (Delta Squash) para o catálogo SQLite (`catalogo.db`) do aplicativo **Aresta Climb**.

---

## 🎯 Arquitetura e Cache na CDN (Sem Custo de Worker em Cache Hit)

1. **URL Determinística por Par de Hashes**:
   `GET https://catalogo.arestaclimb.com/sync?versao_local=<hash_local>&versao_destino=<hash_destino>`
2. **Cache na Borda da Cloudflare CDN (Fora do Worker)**:
   - O Worker **não** utiliza `caches.default` em código; em vez disso, emite cabeçalhos HTTP `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable` quando o delta entre `(versao_local, versao_destino)` é calculado com sucesso, e `Cache-Control: no-store` para respostas de fallback (`full_download`) ou erros.
   - Com a **Cache Rule** ativa na zona `arestaclimb.com` (`Hostname equals catalogo.arestaclimb.com` + `Eligible for cache` + `Use cache-control header if present, bypass cache if not`), qualquer requisição repetida para o mesmo par de hashes é servida diretamente pela CDN da Cloudflare **antes** de invocar o Worker, economizando 100% da cota de requisições do Worker e de leituras do D1.

---

## 🛣️ Rotas

| Rota | Método | Descrição |
| :--- | :--- | :--- |
| `/health` ou `/` | `GET` | Healthcheck operacional do worker. |
| `/sync?versao_local=X&versao_destino=Y` | `GET` | Retorna `acao: "apply_delta"` com `upserts` e `deletes` condensados (Delta Squash) ou `acao: "full_download"` caso a versão local não exista no histórico do D1. |

---

## 🧪 Testes Automatizados (TDD)

```bash
deno test -A cloudflare/catalogo/test/worker_test.ts
```

---

## 🚀 Publicação na Cloudflare

```bash
cd cloudflare/catalogo
npx wrangler deploy
```
