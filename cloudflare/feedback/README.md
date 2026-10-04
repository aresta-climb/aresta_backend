# Aresta Feedback Gateway (`feedback.arestaclimb.com`)

Gateway em borda (Cloudflare Worker) para distribuição de anexos e roteamento desacoplado de diagnósticos do sistema de feedback do **Aresta Climb**.

---

## 🎯 Objetivos de Arquitetura

1. **URLs Canônicas e Imutáveis nas Issues do GitHub**:
   As issues abertas no GitHub comunitário recebem links sob o domínio próprio `https://feedback.arestaclimb.com/anexos/<feedbackId>/screenshot.png`. Isso impede que migrações futuras de infraestrutura de storage quebrem as imagens em issues antigas.
2. **Desacoplamento do Painel de Diagnóstico**:
   A rota `https://feedback.arestaclimb.com/diagnostico/<feedbackId>` redireciona (HTTP 307) para o Table Editor do Supabase Studio. Caso o ID da tabela, a URL do projeto ou a ferramenta de painel mude no futuro, nenhuma URL registrada no GitHub é impactada.
3. **Cache de Alta Performance em Borda (Edge CDN)**:
   Como os anexos de cada feedback são indexados pelo UUIDv4 do envio, os arquivos são imutáveis. O gateway injeta `Cache-Control: public, max-age=31536000, immutable` e `Access-Control-Allow-Origin: *`, garantindo carregamento instantâneo no GitHub.

---

## 🛣️ Rotas

| Rota | Método | Descrição |
| :--- | :--- | :--- |
| `/health` ou `/` | `GET` | Healthcheck operacional do gateway. |
| `/anexos/:id/:arquivo` | `GET` | Proxy de streaming para o bucket público do Supabase Storage. |
| `/diagnostico/:id` | `GET` | Redirecionamento 307 para o Table Editor do Supabase Dashboard. |

---

## 🧪 Testes Automatizados

```bash
deno test -A cloudflare/feedback/test/worker_test.ts
```

---

## 🚀 Publicação na Cloudflare

Para publicar o worker e vincular ao domínio `feedback.arestaclimb.com`:

```bash
cd cloudflare/feedback
npx wrangler deploy
```
