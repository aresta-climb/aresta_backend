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

    // Parse the JSON body from the app
    const data = await req.json();
    const { message, userEmail, userName, category } = data;

    if (!message) {
      return new Response(JSON.stringify({ error: 'Feedback message is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Format the payload for Discord using an Embed for better formatting
    const discordPayload = {
      content: "🚀 **Novo Feedback Recebido do App!**",
      embeds: [{
        color: 5814783, // A nice purple/blue color
        fields: [
          { name: "Usuário", value: userName || "Anônimo", inline: true },
          { name: "Email", value: userEmail || "Não informado", inline: true },
          { name: "Categoria", value: category || "Geral", inline: true },
          { name: "Mensagem", value: message, inline: false }
        ],
        timestamp: new Date().toISOString()
      }]
    };

    // Forward to Discord
    const discordResponse = await fetch(discordWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(discordPayload),
    });

    if (!discordResponse.ok) {
      console.error('Discord error:', await discordResponse.text());
      throw new Error(`Failed to send to Discord (Status: ${discordResponse.status})`);
    }

    // Return success to the app quickly
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
