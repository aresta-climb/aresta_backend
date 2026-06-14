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

    let metadataObj = {};
    try {
      metadataObj = JSON.parse(metadataStr);
    } catch (_) {}

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

    const payloadJson = {
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
      console.error('Discord error:', await discordResponse.text());
      throw new Error(`Failed to send to Discord (Status: ${discordResponse.status})`);
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
