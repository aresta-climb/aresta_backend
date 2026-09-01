#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Aresta Contributors

import { execSync } from "node:child_process";

console.log("\n🧗 ==========================================");
console.log("   Configuração do Aresta Prévia Relay");
console.log("   Domínio: previa.arestaclimb.com");
console.log("==========================================\n");

function executar(comando, descricao, inputStdin = null) {
  console.log(`⏳ ${descricao}...`);
  try {
    const opcoes = { stdio: inputStdin ? ["pipe", "inherit", "inherit"] : "inherit" };
    if (inputStdin) {
      opcoes.input = inputStdin;
    }
    execSync(comando, opcoes);
    console.log(`✅ ${descricao} concluído com sucesso.\n`);
    return true;
  } catch (err) {
    console.error(`❌ Erro em: ${descricao}`);
    return false;
  }
}

// 1. Verificar autenticação Cloudflare
console.log("🔍 Verificando login no Cloudflare Wrangler...");
try {
  execSync("npx wrangler whoami", { stdio: "pipe" });
  console.log("✅ Usuário Cloudflare já autenticado.\n");
} catch {
  console.log("⚠️ Você precisa fazer login na sua conta Cloudflare.");
  console.log("Abrindo navegador para autenticação...\n");
  if (!executar("npx wrangler login", "Login no Cloudflare")) {
    process.exit(1);
  }
}

// 2. Fazer deploy inicial do Worker
console.log("🚀 Publicando o Cloudflare Worker em previa.arestaclimb.com...");
if (!executar("npx wrangler deploy", "Deploy do Worker")) {
  process.exit(1);
}

console.log("\n🎉 ==========================================");
console.log("   PRONTO! O Relay está configurado e publicado.");
console.log("   Verifique o status do serviço em:");
console.log("   👉 https://previa.arestaclimb.com/health");
console.log("==========================================\n");
