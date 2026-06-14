\# Aresta Climb - Supabase Backend



Este repositório contém a infraestrutura de backend e as Edge Functions do \*\*Aresta Climb\*\*, utilizando o \[Supabase](https://supabase.com/). 



O principal objetivo deste backend, no momento, é gerenciar o \*\*Sistema de Feedback In-App\*\*, recebendo relatórios e capturas de tela do aplicativo Flutter e os encaminhando automaticamente para um canal privado do Discord via webhooks, utilizando Edge Functions no Deno.



\## 🗂 Estrutura do Projeto



```text

supabase/

├── .branches/            # Arquivos de gerenciamento de branches locais do Supabase

├── functions/            # Edge Functions (TypeScript/Deno)

│   └── feedback-webhook/ # Função para processar os feedbacks do app

├── migrations/           # Scripts SQL de controle de versão do banco de dados

├── seed.sql              # Dados iniciais para testes locais

└── config.toml           # Configuração principal do Supabase CLI

