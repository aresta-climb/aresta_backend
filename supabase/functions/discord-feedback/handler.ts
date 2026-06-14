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
      throw new Error(`Discord rejeitou a requisição (Status: ${discordResponse.status}). Detalhes: ${errorText}`);
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
