# Aresta Prévia Relay (`previa.arestaclimb.com`)

Retransmissor leve e de streaming em memória na Cloudflare para conexão híbrida e sincronização em tempo real (Live Reload) entre o **Aresta Editor** (Desktop) e o aplicativo móvel **Aresta Climb**.

---

## 🎯 Como Funciona

1. **Broker de Descoberta**: O Editor Desktop abre um WebSocket de saída e registra um código de sessão efêmero de 8 caracteres em Base36 (`k9x2-p83a`) informando também seu endereço IP local e porta.
2. **Proxy Reverso de Streaming**: Quando o celular requisita um arquivo (como `indice.binarypb` ou fotos) através de `https://previa.arestaclimb.com/<codigo>/*`, o Worker repassa a requisição ao computador do editor via WebSocket e devolve a resposta HTTP diretamente, sem gravar nada em disco ou banco.
3. **Distribuidor de Eventos (Live Reload)**: Ao salvar alterações no editor, uma notificação push WebSocket é transmitida instantaneamente a todos os celulares conectados à sessão, instruindo o recarregamento na tela.
4. **Descarte Automático**: A sessão é descartada imediatamente ao fechar o editor, por batimento cardíaco (heartbeat) de 30 segundos ou por inatividade (20-30 min).

---

## 🚀 Instalação e Execução Local

Para rodar localmente durante o desenvolvimento:

```bash
npm install
npm run dev
```

---

## 🧪 Executando Testes

Para executar os testes automatizados com cobertura:

```bash
npm test
```

---

## 🌐 Configuração do Domínio `previa.arestaclimb.com` na Cloudflare


## 🚀 Publicação Automática (Setup Rápido)

Para fazer login na Cloudflare, fazer o deploy do Worker e configurar o domínio `previa.arestaclimb.com` de uma vez só:

```bash
npm run setup
```

### Vínculo do Domínio Customizado
1. Acesse o **[Cloudflare Dashboard](https://dash.cloudflare.com/)**.
2. Navegue até **Workers & Pages** → selecione o worker `aresta-previa-relay`.
3. Vá na aba **Settings** → **Domains & Routes**.
4. Clique em **Add** → **Custom Domain**.
5. Digite: `previa.arestaclimb.com` e confirme.
6. A Cloudflare criará automaticamente o apontamento DNS correspondente e provisionará o certificado SSL/TLS.

---

## 💻 Execução Local durante o Desenvolvimento

```bash
npm run dev
```
