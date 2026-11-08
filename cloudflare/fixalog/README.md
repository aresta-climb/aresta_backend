# Worker Fixalog (`aresta-fixalog-worker`)

Cloudflare Worker responsável pela hospedagem soberana em nuvem dos pacotes periciais `.epub` 3 assinados do Fixalog (`fixalog.app`).

## Responsabilidades
- **Validação Criptográfica na Borda**: Verifica Firebase App Check (`X-Firebase-AppCheck`), JWT do Supabase (`user_id`), vínculo OpenPubkey (`nonce` SHA-256 da chave pública ECDSA no `id_token` OIDC do Google ou Apple) e assinatura digital W3C XML-DSig (`META-INF/signatures.xml`).
- **Histórico Imutável de Versões (`v1`, `v2`...)**: Preserva todas as versões em `fixalog-laudos` (R2) e no banco D1 compartilhado `aresta-catalogo`.
- **Gatekeeper de Moderação em 3 Camadas (CSAM + NSFW)**: Inspeciona fotos e todos os *I-Frames* extraídos no servidor dos vídeos `.mp4` (via tabela `moov/stss`) com o Cloudflare CSAM Scanning Tool e o Cloudflare Workers AI Vision (`S4` e `S12`), disparando alertas para `alertas.arestaclimb.com`.
- **Streaming *Byte-Range* (`206 Partial Content`)**: Serve vídeos e fotos em modo `STORE` diretamente de dentro do `.epub` no R2 usando `indices_zip_json` com `Cache-Control: public, max-age=31536000, immutable`.
