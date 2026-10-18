# Aresta App Links (`aresta.cc`)

Worker em borda (Cloudflare Worker + Cloudflare D1) responsável por atender o domínio curto `https://aresta.cc` (e `www.aresta.cc`), provendo verificação de App Links / Universal Links, páginas HTML SSR com meta tags OpenGraph para preview rico em redes sociais e mensageiros, fallback para as lojas de aplicativos e telemetria de campanhas no Umami.

---

## 🎯 Arquitetura, Cache na CDN e Telemetria Umami

1. **Resolução Instantânea via Cloudflare D1 (`aresta-catalogo`)**:
   - O Worker compartilha o binding `DB` do banco D1 `aresta-catalogo` (alimentado pelo `sincronizar_d1_lib.py` no `aresta_db`), consultando as tabelas `catalogo_croquis` e `catalogo_aresta` para montar o resumo hierárquico da entidade (`croqui`, `grupo`, `setor` ou `escalada`).
2. **Cache na Borda da Cloudflare CDN + Telemetria Umami no Cliente**:
   - As páginas HTML SSR de entidades emitem `Cache-Control: public, max-age=3600, s-maxage=86400` (1 hora no navegador, 24 horas na CDN da Cloudflare), reduzindo drasticamente leituras no D1 e invocações do Worker.
   - Mesmo quando o HTML é entregue diretamente pelo cache da CDN da Cloudflare, o navegador do visitante executa o script oficial do Umami (`https://analytics.arestaclimb.com/script.js`) e dispara o evento customizado `app-link-acesso`, registrando `uid`, `tipo`, `id_slug`, `abrir_mapa`, `origem_link`, `utm_source` e `utm_medium`.
3. **Mapeamento Automático de Prefixos para UTM**:
   - `/s/<uid>`, `/sm/<uid>`, `/ms/<uid>` $\rightarrow$ `utm_source: "compartilhamento"`, `utm_medium: "social"`
   - `/q/<uid>`, `/qm/<uid>`, `/mq/<uid>` $\rightarrow$ `utm_source: "placa_rocha"`, `utm_medium: "qrcode"`
   - Parâmetros explícitos na query string (`?utm_source=...&utm_medium=...`) têm precedência sobre os valores derivados do prefixo.

---

## 🛣️ Rotas

| Rota | Método | Descrição |
| :--- | :--- | :--- |
| `/` | `GET` | Redireciona (`302 Found`) para `https://arestaclimb.com`. |
| `/health` | `GET` | Healthcheck operacional (`200 OK`, `Cache-Control: no-store`). |
| `/.well-known/assetlinks.json` | `GET` | Declaração Digital Asset Links para Android App Links (`app.escalada.croquis`). |
| `/.well-known/apple-app-site-association` | `GET` | Declaração AASA para iOS Universal Links (`Z74K7R3WU7.app.escalada.croquis`). |
| `/<uid>` | `GET` | Página HTML SSR com OpenGraph e fallback de lojas para o UID de 14 caracteres. |
| `/<prefixo>/<uid>` | `GET` | Página HTML SSR com suporte aos prefixos `m`, `s`, `sm`, `ms`, `q`, `qm` e `mq`. |

---

## 🧪 Testes Automatizados (TDD e 100% de Cobertura)

```bash
cd cloudflare/app-links
deno test -A --coverage
```

---

## 🚀 Publicação na Cloudflare

```bash
cd cloudflare/app-links
npx wrangler deploy
```
