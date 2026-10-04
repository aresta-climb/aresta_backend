-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

-- Tabela para persistência isolada e segura de dados técnicos de diagnóstico de feedback
CREATE TABLE IF NOT EXISTS feedback_diagnosticos (
    id UUID PRIMARY KEY, -- mesmo feedback_id UUIDv4 enviado pelo app
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_feedback TEXT NOT NULL DEFAULT 'app',
    croqui_id TEXT,
    app_version TEXT,
    os TEXT,
    os_version TEXT,
    device_model TEXT,
    screen_size TEXT,
    device_orientation TEXT,
    is_dark_mode TEXT,
    connectivity TEXT,
    app_instance_id TEXT,
    navigation_tree TEXT,
    ip_origem TEXT,
    indice_sha256 TEXT,
    croqui_status TEXT,
    thumbnail_status TEXT,
    github_issue_url TEXT,
    payload_completo JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Índices para buscas rápidas
CREATE INDEX IF NOT EXISTS idx_feedback_diagnosticos_created_at ON feedback_diagnosticos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_diagnosticos_croqui_id ON feedback_diagnosticos(croqui_id);
CREATE INDEX IF NOT EXISTS idx_feedback_diagnosticos_tipo ON feedback_diagnosticos(tipo_feedback);

-- Habilitar Row Level Security (RLS)
ALTER TABLE feedback_diagnosticos ENABLE ROW LEVEL SECURITY;

-- Permissões para service_role (Edge Functions) e postgres
GRANT ALL ON feedback_diagnosticos TO service_role;
GRANT ALL ON feedback_diagnosticos TO postgres;

-- Política de RLS: Apenas membros autorizados da equipe Aresta autenticados podem consultar os diagnósticos
CREATE POLICY "Membros da equipe Aresta podem consultar diagnosticos" 
ON feedback_diagnosticos 
FOR SELECT 
TO authenticated 
USING (
    (auth.jwt() ->> 'role') = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'equipe_aresta')::boolean = true
    OR (auth.jwt() ->> 'email') LIKE '%@aresta.climb'
);
