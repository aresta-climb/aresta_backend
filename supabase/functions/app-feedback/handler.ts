/**
 * Edge Function: App Feedback Segura (v2 - GitHub Issues & Supabase Diagnósticos)
 *
 * Propósito:
 * Recebe metadados e imagens (screenshots) enviados pelo App Flutter e os
 * converte em GitHub Issues públicas no repositório comunitário (`aresta-climb/aresta_db`),
 * salvando dados técnicos sensíveis (modelo de aparelho, identificador de instalação, etc.)
 * de forma segregada na tabela restrita `feedback_diagnosticos` no Supabase Postgres protegida por RLS.
 *
 * Medidas de Segurança:
 * 1. Atestação de Integridade de Hardware (Firebase App Check):
 *    Exige o cabeçalho `X-Firebase-AppCheck` e valida o JWT contra o JWKS público do Google.
 * 2. Rate Limiting por IP:
 *    Limita a 5 requisições por minuto por IP de origem, respondendo com HTTP 429 e Retry-After.
 * 3. Idempotência Server-Side:
 *    Usa o `feedback_id` (UUIDv4) gravado em `processed_feedbacks` para evitar duplicatas por timeouts de rede.
 * 4. Resiliência da API do GitHub:
 *    Trata respostas HTTP 429 do GitHub aguardando o tempo indicado no Retry-After antes de falhar.
 * 5. Segregação de Privacidade:
 *    Dados confidenciais nunca são impressos no corpo da issue pública; apenas um link restrito para
 *    o Supabase Dashboard é gerado para uso exclusivo da equipe técnica autorizada.
 * 6. Manutenção Automática (TTL):
 *    Remove registros de controle com mais de 30 dias.
 */
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { extrairChaveSecretaSupabase } from "../compartilhado/cliente_supabase_controle.ts";
import { obterTokenArestaClimbBot } from "../compartilhado/cliente_github_bot.ts";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-firebase-appcheck',
};

// Repositório fixo de destino para issues de feedback comunitário
const REPOSITORIO_GITHUB = 'aresta-climb/aresta_db';

// Cache do conjunto de chaves públicas JWKS do Firebase App Check
const FIREBASE_JWKS_URL = new URL('https://firebaseappcheck.googleapis.com/v1/jwks');
let remoteJWKSet = createRemoteJWKSet(FIREBASE_JWKS_URL);

/**
 * Permite injetar um JWKS customizado para testes unitários.
 */
export function setCustomJWKSet(customJWKS: any) {
  remoteJWKSet = customJWKS;
}

let customTokenProvider: (() => Promise<string>) | null = null;

/**
 * Permite injetar um provedor de token customizado para testes unitários.
 */
export function setCustomTokenProvider(provider: (() => Promise<string>) | null) {
  customTokenProvider = provider;
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
 * Extrai a referência do projeto Supabase a partir da URL padrão do gateway
 * (ex: https://<project-ref>.supabase.co) ou de variáveis de ambiente.
 */
export function extrairProjectRef(supabaseUrl: string): string {
  try {
    const url = new URL(supabaseUrl);
    const partes = url.hostname.split('.');
    if (partes.length >= 2 && partes[0] && partes[0] !== 'localhost') {
      return partes[0];
    }
  } catch (_) {}

  return 'default';
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

    // 3. Obtenção do token do GitHub App do Aresta Climb Bot
    const githubToken = customTokenProvider
      ? await customTokenProvider()
      : await obterTokenArestaClimbBot();

    if (!githubToken) {
      throw new Error(
        'Credenciais do Aresta Climb Bot ausentes ou inválidas. Configure ARESTA_CLIMB_BOT_GITHUB_APP_CLIENT_ID, ARESTA_CLIMB_BOT_GITHUB_APP_PRIVATE_KEY e ARESTA_CLIMB_BOT_GITHUB_APP_INSTALLATION_ID nos Secrets do Supabase.'
      );
    }

    // 4. Processamento do formulário multipart
    const formData = await req.formData();
    const description = formData.get('description')?.toString() || "Sem descrição informada";
    const metadataStr = formData.get('metadata')?.toString() || "{}";
    const screenshot = formData.get('screenshot') as File | null;
    const indiceFile = formData.get('indice_file') as File | null;
    const croquiFile = formData.get('croqui_file') as File | null;

    let metadataObj: Record<string, any> = {};
    try {
      metadataObj = JSON.parse(metadataStr);
    } catch (_) {}

    const feedbackId = metadataObj?.feedbackId || crypto.randomUUID();
    const tipoFeedback = metadataObj?.tipo_feedback === 'croqui' ? 'croqui' : 'app';

    // 5. Verificação de Idempotência no Supabase (se configurado)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = extrairChaveSecretaSupabase();
    const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
    const projectRef = extrairProjectRef(supabaseUrl);

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

    // 6. Upload de arquivos anexos no Supabase Storage (se disponível)
    let screenshotUrl: string | null = null;
    let indiceUrl: string | null = null;
    let croquiUrl: string | null = null;

    if (supabase) {
      const BUCKET_NAME = 'feedback_anexos';

      const uploadArquivoStorage = async (
        file: File,
        caminho: string,
        contentTypePadrao: string
      ): Promise<string | null> => {
        try {
          const buffer = new Uint8Array(await file.arrayBuffer());
          const { error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(caminho, buffer, {
              contentType: file.type || contentTypePadrao,
              upsert: true,
            });

          if (error) {
            console.error(`Erro ao fazer upload de ${caminho} no storage:`, error);
            if (
              error.message?.includes('Bucket not found') ||
              (error as any).statusCode === '404' ||
              (error as any).status === 404
            ) {
              await supabase.storage.createBucket(BUCKET_NAME, { public: true }).catch(() => {});
              const retryRes = await supabase.storage
                .from(BUCKET_NAME)
                .upload(caminho, buffer, {
                  contentType: file.type || contentTypePadrao,
                  upsert: true,
                });
              if (retryRes.error) {
                console.error(`Falha na retentativa de upload de ${caminho}:`, retryRes.error);
                return null;
              }
            } else {
              return null;
            }
          }

          const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(caminho);
          return data?.publicUrl || null;
        } catch (e) {
          console.error(`Exceção ao fazer upload de ${caminho}:`, e);
          return null;
        }
      };

      if (screenshot && screenshot.size > 0) {
        screenshotUrl = await uploadArquivoStorage(
          screenshot,
          `${feedbackId}/screenshot.png`,
          'image/png'
        );
      }

      if (indiceFile && indiceFile.size > 0) {
        indiceUrl = await uploadArquivoStorage(
          indiceFile,
          `${feedbackId}/indice.binarypb`,
          'application/octet-stream'
        );
      }

      if (croquiFile && croquiFile.size > 0) {
        croquiUrl = await uploadArquivoStorage(
          croquiFile,
          `${feedbackId}/compilado.binarypb`,
          'application/octet-stream'
        );
      }
    }

    // 7. Construção do Título, Labels e Corpo da Issue do GitHub
    let msgPreview = "<Sem Mensagem>";
    if (description && description.trim() !== "" && description !== "Sem descrição informada") {
      msgPreview = description.substring(0, 50).replace(/\n/g, ' ');
      if (description.length > 50) msgPreview += '...';
    }

    const title = (tipoFeedback === 'croqui' && metadataObj?.croqui_id)
      ? `[Croqui | ${metadataObj.croqui_id}] ${msgPreview}`
      : (tipoFeedback === 'croqui' ? `[Croqui] ${msgPreview}` : `[App] ${msgPreview}`);

    const labels: string[] = [];
    labels.push(`feedback:${tipoFeedback}`);
    if (metadataObj?.os) {
      labels.push(`so:${String(metadataObj.os).toLowerCase()}`);
    }
    if (tipoFeedback === 'croqui' && metadataObj?.croqui_id) {
      labels.push(`pico:${metadataObj.croqui_id}`);
    }

    const linkSupabase = `https://supabase.com/dashboard/project/${projectRef}/editor/feedback_diagnosticos?filter=id%3Deq%3D${feedbackId}`;

    let body = `## Descrição\n${description}\n\n`;

    if (screenshotUrl) {
      body += `### Captura de Tela\n[![Captura de Tela do Feedback](${screenshotUrl})](${screenshotUrl})\n\n`;
    }

    body += `## Informações Gerais\n`;
    body += `- **Categoria:** ${tipoFeedback === 'croqui' ? 'Sobre o Croqui' : 'Sobre o Aplicativo'}\n`;
    if (metadataObj?.croqui_id) {
      body += `- **Pico / Croqui:** \`${metadataObj.croqui_id}\`\n`;
    }
    body += `- **Versão do App:** \`${metadataObj?.appVersion || 'Desconhecida'}\`\n`;
    if (metadataObj?.os) {
      body += `- **Plataforma:** \`${metadataObj.os}\`\n`;
    }

    if (metadataObj?.croqui_status || metadataObj?.thumbnail_status || metadataObj?.indice_sha256) {
      body += `\n## Auditoria Criptográfica de Sincronização\n`;
      body += `• **Status do Croqui:** \`${metadataObj.croqui_status || 'N/A'}\`\n`;
      body += `• **Status da Miniatura:** \`${metadataObj.thumbnail_status || 'N/A'}\`\n`;
      body += `• **Hash do Índice (SHA256):** \`${metadataObj.indice_sha256 || 'N/A'}\`\n`;
    }

    if (indiceUrl || croquiUrl) {
      body += `\n### Arquivos de Auditoria (Download Direto)\n`;
      if (indiceUrl) {
        body += `- [📥 Baixar indice.binarypb](${indiceUrl})\n`;
      }
      if (croquiUrl) {
        body += `- [📥 Baixar compilado.binarypb](${croquiUrl})\n`;
      }
    }

    body += `\n---\n`;
    body += `🔒 **Diagnóstico Completo (Acesso Restrito - Equipe Aresta):**\n`;
    body += `[Ver diagnóstico completo do dispositivo no Supabase](${linkSupabase})\n`;

    // 7. Envio para a API do GitHub com retentativa em caso de 429
    const githubApiUrl = `https://api.github.com/repos/${REPOSITORIO_GITHUB}/issues`;
    const githubHeaders = {
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Aresta-Feedback-Edge-Function',
      'Content-Type': 'application/json',
    };

    const githubPayload = {
      title,
      body,
      labels,
    };

    let ghResponse = await fetch(githubApiUrl, {
      method: 'POST',
      headers: githubHeaders,
      body: JSON.stringify(githubPayload),
    });

    if (ghResponse.status === 429) {
      console.warn('Rate limit detectado na API do GitHub. Aguardando Retry-After...');
      const retryAfterHeader = ghResponse.headers.get('Retry-After');
      let retryDelayMs = 1500;

      if (retryAfterHeader) {
        const parsed = parseFloat(retryAfterHeader);
        if (!isNaN(parsed) && parsed > 0) {
          retryDelayMs = Math.min(3000, parsed * 1000);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

      ghResponse = await fetch(githubApiUrl, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify(githubPayload),
      });
    }

    if (!ghResponse.ok) {
      const errorText = await ghResponse.text();
      console.error('Erro na resposta do GitHub:', errorText);

      // Remove a trava de idempotência para permitir reenvio pelo App
      if (feedbackId && supabase) {
        await supabase.from('processed_feedbacks').delete().eq('id', feedbackId);
      }

      return new Response(
        JSON.stringify({
          error: `Falha ao entregar para o GitHub (Status: ${ghResponse.status}).`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503,
        }
      );
    }

    const ghData = await ghResponse.json().catch(() => ({}));
    const issueUrl = ghData.html_url || '';

    // 8. Persistência dos Diagnósticos Técnicos Restritos no Supabase Postgres
    if (supabase) {
      const diagnosticoPayload: Record<string, any> = {
        id: feedbackId,
        tipo_feedback: tipoFeedback,
        croqui_id: metadataObj?.croqui_id || null,
        app_version: metadataObj?.appVersion || metadataObj?.app_version || null,
        os: metadataObj?.os || null,
        os_version: metadataObj?.osVersion || metadataObj?.os_version || null,
        device_model: metadataObj?.deviceModel || metadataObj?.device_model || null,
        screen_size: metadataObj?.screenSize || metadataObj?.screen_size || null,
        device_orientation: metadataObj?.deviceOrientation || metadataObj?.device_orientation || null,
        is_dark_mode: metadataObj?.isDarkMode !== undefined ? String(metadataObj.isDarkMode) : null,
        connectivity: metadataObj?.connectivity || null,
        app_instance_id: metadataObj?.appInstanceId || metadataObj?.app_instance_id || null,
        navigation_tree: metadataObj?.navigationTree
          ? (typeof metadataObj.navigationTree === 'string' ? metadataObj.navigationTree : JSON.stringify(metadataObj.navigationTree))
          : null,
        ip_origem: clientIp,
        indice_sha256: metadataObj?.indice_sha256 || null,
        croqui_status: metadataObj?.croqui_status || null,
        thumbnail_status: metadataObj?.thumbnail_status || null,
        github_issue_url: issueUrl || null,
        screenshot_url: screenshotUrl || null,
        indice_url: indiceUrl || null,
        croqui_url: croquiUrl || null,
        payload_completo: {
          ...metadataObj,
          screenshot_url: screenshotUrl || null,
          indice_url: indiceUrl || null,
          croqui_url: croquiUrl || null,
        },
      };

      let { error: diagError } = await supabase
        .from('feedback_diagnosticos')
        .insert(diagnosticoPayload);

      // Se a coluna ainda não existir no Postgres caso a migration não tenha rodado, faz fallback gracioso
      if (diagError && diagError.message?.includes('column')) {
        delete diagnosticoPayload.screenshot_url;
        delete diagnosticoPayload.indice_url;
        delete diagnosticoPayload.croqui_url;
        const resRetry = await supabase
          .from('feedback_diagnosticos')
          .insert(diagnosticoPayload);
        diagError = resRetry.error;
      }

      if (diagError) {
        console.error('Erro ao salvar diagnóstico restrito no Supabase:', diagError);
      }
    }

    // 9. Manutenção Automática (TTL 30 dias na tabela de idempotência)
    if (supabase) {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('processed_feedbacks').delete().lt('created_at', thirtyDaysAgo);
      } catch (e) {
        console.error('Erro ao limpar feedbacks antigos:', e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Feedback enviado com sucesso!',
        issue_url: issueUrl,
      }),
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
