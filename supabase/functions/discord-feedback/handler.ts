/**
 * Edge Function: Discord Feedback Forwarder
 * 
 * Propósito:
 * Recebe metadados e imagens (screenshots) enviados pelo App Flutter e os
 * repassa para um webhook do Discord de forma segura e formatada.
 * 
 * Características Principais:
 * 1. Idempotência Server-Side: O App envia um `feedback_id` (UUIDv4) no payload. 
 *    Esta função verifica na tabela `processed_feedbacks` se o ID já foi processado.
 *    Se o App sofrer um "falso timeout" por rede fraca e tentar reenviar o mesmo 
 *    feedback, a constraint de unicidade do banco interceptará e bloqueará a 
 *    duplicação, retornando sucesso silencioso.
 * 2. Manutenção Zero (TTL): Para evitar que a tabela de controle cresça
 *    indefinidamente, a função executa um Garbage Collection leve no final de
 *    cada requisição, apagando registros processados há mais de 30 dias.
 * 3. Variáveis de Ambiente Necessárias:
 *    - DISCORD_WEBHOOK_URL (URL do webhook do canal)
 *    - APP_API_KEY (Chave de segurança compartilhada com o client)
 *    * As chaves do Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) são automáticas.
 */
import { createClient } from "@supabase/supabase-js";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const handleRequest = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const discordWebhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL');
    if (!discordWebhookUrl) {
      throw new Error('DISCORD_WEBHOOK_URL variable is not set in Supabase Secrets');
    }

    const expectedApiKey = Deno.env.get('APP_API_KEY');
    const providedApiKey = req.headers.get('x-api-key');

    // Validação da API KEY para segurança da rota
    if (expectedApiKey && providedApiKey !== expectedApiKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    // Processar multipart/form-data enviado pelo App
    const formData = await req.formData();
    const description = formData.get('description')?.toString() || "Sem descrição informada";
    const metadataStr = formData.get('metadata')?.toString() || "{}";
    const screenshot = formData.get('screenshot') as File | null;

    let metadataObj: Record<string, any> = {};
    try {
      metadataObj = JSON.parse(metadataStr);
    } catch (_) {}

    const feedbackId = metadataObj?.feedback_id;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Idempotency Check: if an ID is present, try to insert it.
    if (feedbackId) {
      const { error: insertError } = await supabase
        .from('processed_feedbacks')
        .insert({ id: feedbackId });

      // If it fails due to a unique constraint violation (duplicate), it means it was already processed.
      if (insertError) {
        if (insertError.code === '23505') { // Postgres code for unique_violation
          console.log(`Duplicate feedback ${feedbackId} detected. Skipping.`);
          return new Response(JSON.stringify({ success: true, message: 'Already processed' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          });
        } else {
          console.error('Supabase DB error:', insertError);
        }
      }
    }

    // Preparar o payload para o Discord Webhook (suporta envio de arquivo no form-data)
    const discordFormData = new FormData();
    
    // Constrói os campos do Embed com base nos metadados coletados
    const embedFields = [
      { name: "Descrição", value: description, inline: false },
    ];

    if (metadataObj) {
      // Formata os metadados como um bloco de código JSON para ficar bonito no Discord
      embedFields.push({
        name: "Metadados de Debug",
        value: "```json\n" + JSON.stringify(metadataObj, null, 2).substring(0, 1000) + "\n```",
        inline: false
      });
    }

    let msgPreview = "<No Message>";
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
        hour: '2-digit', minute: '2-digit'
      }).format(new Date());
    } catch (e) {
      timestampStr = new Date().toISOString();
    }

    const threadName = `${timestampStr} - v${appVersion} - ${msgPreview}`;

    const payloadJson = {
      thread_name: threadName,
      content: "🚀 **Novo Bug/Feedback Reportado no App!**",
      embeds: [{
        color: 16711680, // Vermelho/Laranja para Bug Report
        fields: embedFields,
        timestamp: new Date().toISOString()
      }]
    };

    discordFormData.append('payload_json', JSON.stringify(payloadJson));

    // Anexa a imagem caso o app tenha mandado
    if (screenshot) {
      discordFormData.append('file', screenshot, 'screenshot.png');
    }

    // Encaminha para o Discord
    const discordResponse = await fetch(discordWebhookUrl, {
      method: 'POST',
      body: discordFormData,
    });

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text();
      console.error('Discord error:', errorText);
      // Rollback insert if Discord failed
      if (feedbackId) {
        await supabase.from('processed_feedbacks').delete().eq('id', feedbackId);
      }
      throw new Error(`Discord rejeitou a requisição (Status: ${discordResponse.status}). Detalhes: ${errorText}`);
    }

    // TTL Zero Maintenance: Delete records older than 30 days probabilistically (or every time)
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('processed_feedbacks').delete().lt('created_at', thirtyDaysAgo);
    } catch (e) {
      console.error('Error deleting old feedbacks:', e);
    }

    // Retorna sucesso rapidamente para o App remover da fila
    return new Response(JSON.stringify({ success: true, message: 'Feedback sent successfully!' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
};
