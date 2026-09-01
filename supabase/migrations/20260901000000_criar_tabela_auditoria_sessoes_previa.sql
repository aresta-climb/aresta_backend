-- SPDX-License-Identifier: MPL-2.0
-- Copyright (C) 2026 Aresta Contributors

-- Tabela de auditoria de sessões de prévia e live reload de croquis
CREATE TABLE IF NOT EXISTS auditoria_sessoes_previa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    usuario_email TEXT NOT NULL,
    codigo VARCHAR(16) NOT NULL,
    url_previa TEXT NOT NULL,
    ip_origem TEXT,           -- IP público da conexão (CF-Connecting-IP)
    ip_local TEXT,            -- IP privado na rede local (Wi-Fi)
    porta_local INTEGER,      -- Porta local do servidor HTTP
    user_agent TEXT,          -- User-Agent / SO do cliente
    iniciado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    encerrado_em TIMESTAMP WITH TIME ZONE,
    duracao_segundos INTEGER,
    motivo_encerramento TEXT  -- 'desconexao_editor', 'inatividade', 'fechamento_manual'
);

-- Índices de consulta rápida e auditoria
CREATE INDEX IF NOT EXISTS idx_auditoria_previas_usuario_id ON auditoria_sessoes_previa(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_previas_codigo ON auditoria_sessoes_previa(codigo);
CREATE INDEX IF NOT EXISTS idx_auditoria_previas_iniciado_em ON auditoria_sessoes_previa(iniciado_em);

-- Habilitar Row Level Security (RLS)
ALTER TABLE auditoria_sessoes_previa ENABLE ROW LEVEL SECURITY;

-- Permissões para service_role (usada pelo Cloudflare Worker / Edge Functions) e postgres
GRANT ALL ON auditoria_sessoes_previa TO service_role;
GRANT ALL ON auditoria_sessoes_previa TO postgres;

-- Política RLS: Usuários autenticados podem visualizar seus próprios registros de prévia
CREATE POLICY "Usuarios podem visualizar suas proprias sessoes de previa"
ON auditoria_sessoes_previa
FOR SELECT
TO authenticated
USING (
    usuario_email = (auth.jwt() ->> 'email')
    OR usuario_id = auth.uid()
);

-- Função de limpeza periódica para retenção máxima de 90 dias
CREATE OR REPLACE FUNCTION public.limpar_auditoria_sessoes_antigas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.auditoria_sessoes_previa
    WHERE iniciado_em < (NOW() - INTERVAL '90 days');
END;
$$;

-- Agendamento diário automático às 03:00 UTC via pg_cron (se disponível)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'limpeza-auditoria-previas-90d',
            '0 3 * * *',
            'SELECT public.limpar_auditoria_sessoes_antigas()'
        );
    END IF;
END $$;
