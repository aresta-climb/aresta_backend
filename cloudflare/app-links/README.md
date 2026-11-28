# Aresta App Links & Vitrine Web (`aresta.cc` e `arestaclimb.com/croquis`)

Worker em borda (Cloudflare Worker + Cloudflare D1) responsável por atender tanto o encurtador `https://aresta.cc` (`www.aresta.cc`) quanto a vitrine pública indexável `https://arestaclimb.com/croquis*`, provendo verificação de App Links / Universal Links, redirecionamento permanente (`301`) preservando CGI args/UTMs, Mapão nacional leve de picos, JSON compacto para busca client-side, `sitemap.xml` e páginas HTML SSR de teaser com OpenGraph e telemetria Umami.

---

## 🎯 Arquitetura, Cache Agressivo na CDN e SEO

1. **Vitrine Centralizada em `arestaclimb.com/croquis*`**:
   - **`GET /croquis`**: Renderiza o diretório público agrupado por estado unido ao **Mapão Nacional** (MapLibre GL JS + tiles vetoriais gratuitos do OpenFreeMap em modo claro/escuro, sem chave de API nem marca d'água) e barra de busca instantânea que consome `/croquis/busca.json` sob demanda no navegador.
   - **`GET /croquis/busca.json`**: Índice compacto cacheado na CDN por 7 dias com croquis, grupos, setores e escaladas para filtragem em `0ms` sem acionar o Worker a cada tecla digitada.
   - **`GET /croquis/sitemap.xml`**: Sitemap XML dinâmico de todas as ~5.000 URLs canônicas para indexação orgânica no Google.
   - **`GET /croquis/<uid>/<slug>`**: Página SSR de teaser com os 14 caracteres do UID na frente (redirecionando `301` caso falte o `<slug>` ou este tenha mudado após renomeação), `<link rel="canonical">`, JSON-LD `BreadcrumbList`, trilha de breadcrumbs clicáveis, botão de localização no Google Maps, listagem clicável de subentidades (setores do pico / vias do setor) e CTAs de download/abertura do app.
2. **Redirecionamento Permanente de `aresta.cc` e `www.aresta.cc` (1 pulo direto)**:
   - Tanto a raiz (`/`) quanto as rotas curtas `/{uid}` e `/{prefixo}/{uid}` (`m`, `s`, `sm`, `ms`, `q`, `qm`, `mq`) em `aresta.cc` e `www.aresta.cc` emitem `301 Moved Permanently` em **1 único salto** direto para `https://arestaclimb.com/croquis*` preservando query strings, `?mapa=1`, `utm_source` e `utm_medium`.
   - `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association` e `/og/<id_slug>.webp` permanecem respondendo `200 OK` diretamente em `aresta.cc`.
   - Como o Workers Caching (`"cache": { "enabled": true }`) utiliza `(entrypoint, versão, pathname + search)` sem `hostname` na chave de cache, acessos a `/croquis*` fora do host canônico `arestaclimb.com` (`www.arestaclimb.com`, `aresta.cc`, `www.aresta.cc`) redirecionam `301` com `Cache-Control: private, max-age=86400` (`BYPASS` no cache compartilhado da borda) para impedir colisão/loop de cache por host.
3. **Cache Key sem Query String + Telemetria Umami Client-Side**:
   - Com a Cache Rule ativa na zona `arestaclimb.com` (*Eligible for cache* + *Ignore query string*), o HTML SSR é entregue em `~15ms` diretamente da borda da Cloudflare CDN com zero invocações do Worker, enquanto o script no navegador lê `window.location.search` para registrar os parâmetros CGI/UTM no Umami e repassá-los ao link mobile `aresta://`.

---

## 🛣️ Rotas

| Domínio / Rota | Método | Descrição |
| :--- | :--- | :--- |
| `[www.]aresta.cc/` | `GET` | Redireciona (`301`) em 1 pulo para `https://arestaclimb.com/croquis` (preservando query string). |
| `aresta.cc/health` | `GET` | Healthcheck operacional (`200 OK`, `Cache-Control: no-store`). |
| `aresta.cc/.well-known/*` | `GET` | Declarações Digital Asset Links (Android) e AASA (iOS). |
| `aresta.cc/og/<id_slug>.webp` | `GET`, `HEAD` | Proxy de miniatura OpenGraph `600x600` WebP com cache de 7 dias na borda. |
| `[www.]aresta.cc/[<prefixo>/]<uid>` | `GET` | Redireciona (`301`) em 1 pulo para `https://arestaclimb.com/croquis/<uid>/<slug>` preservando CGI args/UTMs. |
| `arestaclimb.com/croquis` | `GET` | Página índice com Mapão nacional, busca rápida e diretório por estado. |
| `arestaclimb.com/croquis/busca.json` | `GET` | Índice JSON compacto para busca client-side instantânea. |
| `arestaclimb.com/croquis/sitemap.xml` | `GET` | Sitemap XML completo do catálogo público. |
| `arestaclimb.com/croquis/<uid>[/<slug>]` | `GET` | Teaser SSR hierárquico da entidade (`301` automático para o `<slug>` canônico). |

---

## 🧪 Testes Automatizados (TDD e 100% de Cobertura)

```bash
cd cloudflare/app-links
deno test -A --coverage test/
```

---

## 🚀 Publicação na Cloudflare

```bash
cd cloudflare/app-links
npx wrangler deploy
```
