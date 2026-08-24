/**
 * Edge Function: App Feedback Segura (v1)
 *
 * Propósito:
 * Recebe metadados e imagens (screenshots) enviados pelo App Flutter e os
 * repassa para o canal de destino (Discord Webhook) de forma segura, auditada e formatada.
 *
 * Medidas de Segurança:
 * 1. Atestação de Integridade de Hardware (Firebase App Check):
 *    Exige o cabeçalho `X-Firebase-AppCheck` e valida o JWT contra o JWKS público do Google.
 * 2. Rate Limiting por IP:
 *    Limita a 5 requisições por minuto por IP de origem, respondendo com HTTP 429 e Retry-After.
 * 3. Idempotência Server-Side:
 *    Usa o `feedback_id` (UUIDv4) gravado em `processed_feedbacks` para evitar duplicatas por timeouts de rede.
 * 4. Resiliência do Webhook:
 *    Trata respostas HTTP 429 do Discord aguardando o tempo indicado no Retry-After antes de falhar.
 * 5. Manutenção Automática (TTL):
 *    Remove registros de controle com mais de 30 dias.
 */
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { extrairChaveSecretaSupabase } from "../compartilhado/cliente_supabase_controle.ts";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-firebase-appcheck',
};

// Cache do conjunto de chaves públicas JWKS do Firebase App Check
const FIREBASE_JWKS_URL = new URL('https://firebaseappcheck.googleapis.com/v1/jwks');
let remoteJWKSet = createRemoteJWKSet(FIREBASE_JWKS_URL);

/**
 * Permite injetar um JWKS customizado para testes unitários.
 */
export function setCustomJWKSet(customJWKS: any) {
  remoteJWKSet = customJWKS;
}

// Estrutura em memória para controle de Rate Limit por IP (Janela deslizante de 60s)
const ipRequestTimestamps = new Map<string, number[]>();

/**
 * Limpa o histórico de rate limit (útil para testes unitários).
 */
export function resetRateLimits() {
  ipRequestTimestamps.clear();
}

/**
 * Valida se o IP atual está dentro do limite de requisições por minuto.
 */
export function checkRateLimit(
  clientIp: string,
  limitPerMinute = 5,
  windowMs = 60000,
  now = Date.now()
): { allowed: boolean; retryAfterSeconds: number } {
  const timestamps = ipRequestTimestamps.get(clientIp) || [];
  
  // Filtra apenas timestamps dentro da janela atual
  const validTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (validTimestamps.length >= limitPerMinute) {
    const oldest = validTimestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    ipRequestTimestamps.set(clientIp, validTimestamps);
    return { allowed: false, retryAfterSeconds };
  }

  validTimestamps.push(now);
  ipRequestTimestamps.set(clientIp, validTimestamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Valida o token JWT do Firebase App Check.
 */
export async function verifyAppCheckToken(
  token: string,
  projectNumber: string,
  projectId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    await jwtVerify(token, remoteJWKSet, {
      issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
      audience: [
        `projects/${projectNumber}`,
        `projects/${projectId}`,
      ],
    });
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Token do App Check inválido' };
  }
}

/**
 * Função principal para processar a requisição de feedback.
 */
export const handleRequest = async (req: Request): Promise<Response> => {
  // Trata requisições OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Extração do IP do cliente e verificação de Rate Limit
    const clientIp =
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      'unknown-ip';

    const maxRate = parseInt(Deno.env.get('RATE_LIMIT_PER_MINUTE') ?? '5', 10);
    const rateCheck = checkRateLimit(clientIp, maxRate);

    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Muitas requisições. Por favor, aguarde alguns instantes antes de reenviar.',
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(rateCheck.retryAfterSeconds),
          },
          status: 429,
        }
      );
    }

    // 2. Validação do Firebase App Check
    const skipAppCheck = Deno.env.get('SKIP_APP_CHECK_VERIFICATION') === 'true';
    if (!skipAppCheck) {
      const appCheckToken = req.headers.get('X-Firebase-AppCheck') || req.headers.get('x-firebase-appcheck');
      if (!appCheckToken) {
        return new Response(
          JSON.stringify({ error: 'Acesso negado: Token de atestação do App Check ausente.' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403,
          }
        );
      }

      const projectNumber = Deno.env.get('FIREBASE_PROJECT_NUMBER') ?? '737982062809';
      const projectId = Deno.env.get('FIREBASE_PROJECT_ID') ?? 'app-escalada-croquis';

      const tokenVerification = await verifyAppCheckToken(appCheckToken, projectNumber, projectId);
      if (!tokenVerification.valid) {
        return new Response(
          JSON.stringify({ error: `Acesso negado: ${tokenVerification.error}` }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403,
          }
        );
      }
    }

    // 3. Validação da variável de ambiente do Discord
    const discordWebhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL');
    if (!discordWebhookUrl) {
      throw new Error('Variável DISCORD_WEBHOOK_URL não configurada no Supabase Secrets.');
    }

    // 4. Processamento do formulário multipart
    const formData = await req.formData();
    const description = formData.get('description')?.toString() || "Sem descrição informada";
    const metadataStr = formData.get('metadata')?.toString() || "{}";
    const screenshot = formData.get('screenshot') as File | null;

    let metadataObj: Record<string, any> = {};
    try {
      metadataObj = JSON.parse(metadataStr);
    } catch (_) {}

    const feedbackId = metadataObj?.feedbackId;

    // 5. Verificação de Idempotência no Supabase (se configurado)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = extrairChaveSecretaSupabase();
    const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

    if (feedbackId && supabase) {
      const { error: insertError } = await supabase
        .from('processed_feedbacks')
        .insert({ id: feedbackId });

      if (insertError) {
        if (insertError.code === '23505') {
          console.log(`Feedback duplicado ${feedbackId} detectado. Retornando sucesso.`);
          return new Response(
            JSON.stringify({ success: true, message: 'Já processado anteriormente.' }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            }
          );
        } else {
          console.error('Erro no banco de dados do Supabase:', insertError);
        }
      }
    }

    // 6. Construção do Payload do Discord
    const discordFormData = new FormData();
    const embedFields = [
      { name: "Descrição", value: description, inline: false },
    ];

    if (metadataObj) {
      embedFields.push({
        name: "Metadados de Debug",
        value: "```json\n" + JSON.stringify(metadataObj, null, 2).substring(0, 1000) + "\n```",
        inline: false,
      });
    }

    let msgPreview = "<Sem Mensagem>";
    if (description && description.trim() !== "" && description !== "Sem descrição informada") {
      msgPreview = description.substring(0, 40).replace(/\n/g, ' ');
      if (description.length > 40) msgPreview += '...';
    }

    const appVersion = metadataObj?.appVersion || 'Desconhecida';
    let timestampStr = "";
    try {
      timestampStr = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date());
    } catch (_) {
      timestampStr = new Date().toISOString();
    }

    const threadName = `${timestampStr} - v${appVersion} - ${msgPreview}`;

    const payloadJson = {
      thread_name: threadName,
      content: "🚀 **Novo Feedback / Relato de Bug no App!**",
      embeds: [{
        color: 16711680,
        fields: embedFields,
        timestamp: new Date().toISOString(),
      }],
    };

    discordFormData.append('payload_json', JSON.stringify(payloadJson));

    if (screenshot) {
      discordFormData.append('file', screenshot, 'screenshot.png');
    }

    // 7. Envio para o Discord com tratamento de Retry para Rate Limit (429)
    let discordResponse = await fetch(discordWebhookUrl, {
      method: 'POST',
      body: discordFormData,
    });

    if (discordResponse.status === 429) {
      console.warn('Rate limit detectado no Discord Webhook. Aguardando Retry-After...');
      const retryAfterHeader = discordResponse.headers.get('Retry-After');
      let retryDelayMs = 1500;

      if (retryAfterHeader) {
        const parsed = parseFloat(retryAfterHeader);
        if (!isNaN(parsed) && parsed > 0) {
          retryDelayMs = Math.min(3000, parsed * 1000);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

      discordResponse = await fetch(discordWebhookUrl, {
        method: 'POST',
        body: discordFormData,
      });
    }

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text();
      console.error('Erro na resposta do Discord:', errorText);

      // Remove a trava de idempotência para permitir reenvio pelo App
      if (feedbackId && supabase) {
        await supabase.from('processed_feedbacks').delete().eq('id', feedbackId);
      }

      return new Response(
        JSON.stringify({
          error: `Falha ao entregar para o Discord (Status: ${discordResponse.status}).`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503,
        }
      );
    }

    // 8. Garbage Collection (TTL 30 dias)
    if (supabase) {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('processed_feedbacks').delete().lt('created_at', thirtyDaysAgo);
      } catch (e) {
        console.error('Erro ao limpar feedbacks antigos:', e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Feedback enviado com sucesso!' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Erro na execução da função:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno do servidor.' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
};
