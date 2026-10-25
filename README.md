# Aresta Climb - Supabase Backend

Este repositório contém a infraestrutura de backend e as Edge Functions do **Aresta Climb**, utilizando o [Supabase](https://supabase.com/).

## 🎯 Funcionalidades Principais

1. **Sistema de Colaboração e Publicação do Aresta Editor**:
   - `git-proxy`: Proxy transparente para Git Smart HTTP com firewall de branch (`sugestao-*`), verificação de colisão e controle de autoria.
   - `create-pr`: API REST para validação de escopo de pastas (`database/` restrito) e abertura de Pull Requests automatizados via Bot no GitHub (`aresta-climb/aresta_db`).
2. **Sistema de Feedback In-App**:
   - `app-feedback`: Processamento seguro de relatórios, capturas de tela e diagnósticos do app móvel (com validação via Firebase App Check) para abertura de Issues no GitHub e persistência restrita no Supabase.
3. **Cloudflare Workers em Borda (`cloudflare/`)**:
   - `catalogo` (`catalogo.arestaclimb.com`): Sincronização incremental (Delta Squash) do catálogo SQLite (`catalogo.db`) via Cloudflare D1.
   - `feedback` (`feedback.arestaclimb.com`): Proxy com cache imutável para anexos de feedback e redirecionamento para diagnóstico no Supabase.
   - `app-links` (`aresta.cc`): Verificação de Android App Links / iOS Universal Links (`.well-known`), páginas HTML SSR com preview OpenGraph, fallback para lojas e telemetria Umami (`utm_source` / `utm_medium`).
   - `previa` (`previa.arestaclimb.com`): Proxy de artefatos de prévia de Pull Requests e túnel WebSocket do Editor Desktop.
   - `alertas` (`alertas.arestaclimb.com`): Roteador central de webhooks assinados (Sentry e GitHub) para dois grupos da Comunidade no WhatsApp via WAHA (`NOWEB` em GCP `e2-micro`) com fallback automático de e-mail via Resend (`contato@arestaclimb.com`). Consulte o guia completo em `../aresta_app/docs/guia_configuracao_observabilidade_e_alertas.md`.

---

## 🗂 Estrutura do Projeto

```text
cloudflare/
├── alertas/              # Worker roteador de alertas WhatsApp WAHA + fallback Resend (alertas.arestaclimb.com)
├── app-links/            # Worker de App Links, OpenGraph SSR e Umami (aresta.cc)
├── catalogo/             # Worker de Delta Sync do catálogo SQLite (catalogo.arestaclimb.com)
├── feedback/             # Worker de proxy de anexos de feedback (feedback.arestaclimb.com)
└── previa/               # Worker de prévia de Pull Requests (previa.arestaclimb.com)
supabase/
├── config.toml           # Configuração principal do Supabase CLI
├── migrations/           # Scripts SQL de controle de versão do banco de dados
│   ├── 20260617002731_create_processed_feedbacks.sql
│   ├── 20260617013500_grant_service_role_processed_feedbacks.sql
│   └── 20260823000000_criar_tabela_sugestoes_branches.sql
└── functions/            # Edge Functions (Deno / TypeScript)
    ├── deno.json         # Import map compartilhado
    ├── compartilhado/    # Bibliotecas modulares e autocontidas (Library-First)
    │   ├── analisador_pkt_line.ts
    │   ├── cliente_github_bot.ts
    │   ├── cliente_supabase_controle.ts
    │   ├── relator_sentry.ts
    │   ├── relator_sentry_fake.ts
    │   ├── validador_cabecalhos_spdx.ts
    │   ├── validador_escopo_arquivos.ts
    │   └── validador_regras_branch.ts
    ├── git-proxy/        # Função de proxy Git Smart HTTP
    ├── create-pr/        # Função de criação de Pull Requests
    └── app-feedback/     # Função de recebimento de feedbacks In-App
```

---

## 📧 Configuração do Supabase Auth com Resend

Para o envio de códigos de autenticação (OTP de 6 dígitos) do Aresta Editor:

1. **Domínio no Resend:**
   - Domínio verificado: `login.arestaclimb.com`
   - Obtenha a API Key em [resend.com](https://resend.com).
2. **SMTP no Supabase:**
   - Em **Project Settings → Authentication → SMTP Settings**:
     - **Enable Custom SMTP**: Habilitado
     - **Sender Email**: `nao-responda@login.arestaclimb.com`
     - **Sender Name**: `Aresta Editor`
     - **Host**: `smtp.resend.com`
     - **Port**: `465` (SSL) ou `587` (TLS)
     - **User**: `resend`
     - **Password**: `<SUA_RESEND_API_KEY>`
3. **Template de Email (OTP):**
   - Em **Authentication → Email Templates → Magic Link / OTP**:
     ```html
     <h2>Seu código de acesso ao Aresta Editor</h2>
     <p>Insira o código abaixo no aplicativo para continuar:</p>
     <h1 style="letter-spacing: 5px; font-size: 32px; color: #2b8a3e;">{{ .Token }}</h1>
     <p>Este código expira em 1 hora.</p>
     ```

---

## 🔑 Variáveis de Ambiente (Secrets)

As Edge Functions utilizam as seguintes variáveis de ambiente:

* `GITHUB_BOT_TOKEN`: **(Obrigatório)** Token de acesso pessoal (PAT Fine-Grained ou Classic) ou de GitHub App com permissão de escrita (`Contents: Read & Write`, `Pull Requests: Read & Write`) no repositório `aresta-climb/aresta_db`.
* `SUPABASE_URL`: **(Automático)** Injetada automaticamente pelo Supabase nas Edge Functions.
* `SUPABASE_SECRET_KEYS`: **(Automático)** Dicionário JSON de chaves secretas injetado automaticamente pelo Supabase.

---

## 🧪 Executando os Testes

Conforme estabelecido em nossos [Princípios de Engenharia](AGENTS.md), seguimos TDD com testes orientados a comportamento e 100% de cobertura. Para rodar todos os testes unitários, de integração e de conformidade SPDX (incluindo Supabase Edge Functions e Cloudflare Workers):

```bash
deno test -A --config supabase/functions/deno.json supabase/functions/ cloudflare/alertas/test/ cloudflare/app-links/test/ cloudflare/catalogo/test/ cloudflare/feedback/test/ cloudflare/previa/test/
```
