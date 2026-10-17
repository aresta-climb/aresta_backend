# Aresta Climb - Supabase Backend

Este repositório contém a infraestrutura de backend e as Edge Functions do **Aresta Climb**, utilizando o [Supabase](https://supabase.com/).

## 🎯 Funcionalidades Principais

1. **Sistema de Colaboração e Publicação do Aresta Editor**:
   - `git-proxy`: Proxy transparente para Git Smart HTTP com firewall de branch (`sugestao-*`), verificação de colisão e controle de autoria.
   - `create-pr`: API REST para validação de escopo de pastas (`database/` restrito) e abertura de Pull Requests automatizados via Bot no GitHub (`aresta-climb/aresta_db`).
2. **Sistema de Feedback In-App**:
   - `app-feedback` / `discord-feedback`: Processamento de relatórios e capturas de tela do app móvel para canais privados no Discord.

---

## 🗂 Estrutura do Projeto

```text
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
    │   ├── validador_escopo_arquivos.ts
    │   └── validador_regras_branch.ts
    ├── git-proxy/        # Função de proxy Git Smart HTTP
    ├── create-pr/        # Função de criação de Pull Requests
    ├── app-feedback/
    └── discord-feedback/
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

Conforme estabelecido em nossos [Princípios de Engenharia](AGENTS.md), seguimos TDD com testes orientados a comportamento e 100% de cobertura. Para rodar todos os testes unitários e de integração:

```bash
deno test -A --config supabase/functions/deno.json
```
