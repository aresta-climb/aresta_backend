# Aresta App Links (`aresta.cc`)

Worker em borda (Cloudflare Worker + Cloudflare D1) responsável por atender o domínio curto `https://aresta.cc` (e `www.aresta.cc`), provendo verificação de App Links / Universal Links, páginas HTML SSR com meta tags OpenGraph para preview rico em redes sociais e mensageiros, fallback visual integrado ao Design System do Aresta Climb e telemetria de campanhas no Umami.

---

## 🎯 Arquitetura, UI Responsiva, Cache na CDN e Telemetria Umami

1. **Resolução Instantânea via Cloudflare D1 (`aresta-catalogo`)**:
   - O Worker compartilha o binding `DB` do banco D1 `aresta-catalogo` (alimentado pelo `sincronizar_d1_lib.py` no `aresta_db`), consultando as tabelas `catalogo_croquis` e `catalogo_aresta` para montar o resumo hierárquico da entidade (`croqui`, `grupo`, `setor` ou `escalada`).
2. **Design System Light/Dark Mode e Layout Mobile-First**:
   - As páginas HTML SSR (`200 OK` e `404 Not Found`) compartilham os tokens visuais de `arestaclimb.com` (Arenito, Terracota, Sálvia e Obsidian) com detecção automática de `prefers-color-scheme`, persistência em `localStorage('aresta-theme')`, botão `#themeToggle` e cabeçalho com a logo oficial (`logo_app.png`).
   - **Mobile-First (inspirado na `PicoPage` do aplicativo)**: exibe a miniatura `600x600` (`1:1`) em largura total sem cortes (`aspect-ratio: 1 / 1`), com gradiente inferior fundindo ao fundo, título sobreposto, subtítulo em verde-musgo, banner de download estilo `BannerModoOnline` com os selos clássicos `.store-badge` (contendo os ícones SVG oficiais da Apple App Store e Google Play), link discreto *"Já tem o Aresta instalado? Abrir no aplicativo →"* (visível exclusivamente no mobile + meta tag `apple-itunes-app` para iOS) e cards de contexto estilo `PicoMenuCard`.
   - **Desktop (`@media (min-width: 820px)`)**: transforma o contêiner em um Card de 2 Colunas com a miniatura `1:1` à esquerda (sem cortes) e as informações e botões das lojas à direita (ocultando o link `aresta://`).
   - **Normalização de Metadados**: capitaliza a modalidade (`Boulder`, `Esportiva`, `Tradicional`, `Multienfiada`, `Highline`), usa etiqueta específica para `Boulder` e `Highline`, e remove os prefixos redundantes `"Setor "` e `"Grupo "` (`"Setor Tramontina"` $\rightarrow$ `"Setor: Tramontina"`).
3. **Cache na Borda da Cloudflare CDN + Telemetria Umami no Cliente**:
   - As páginas HTML SSR de entidades emitem `Cache-Control: public, max-age=3600, s-maxage=86400` (1 hora no navegador, 24 horas na CDN da Cloudflare), reduzindo drasticamente leituras no D1 e invocações do Worker.
   - Mesmo quando o HTML é entregue diretamente pelo cache da CDN da Cloudflare, o navegador do visitante executa o script oficial do Umami (`https://analytics.arestaclimb.com/script.js`) e dispara o evento customizado `app-link-acesso`, registrando `uid`, `tipo`, `id_slug`, `abrir_mapa`, `origem_link`, `utm_source` e `utm_medium`.
4. **Mapeamento Automático de Prefixos para UTM**:
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
