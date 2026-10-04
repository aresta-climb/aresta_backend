-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

-- Criação do bucket público para capturas de tela e binários de auditoria dos feedbacks
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback_anexos', 'feedback_anexos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de RLS para o bucket feedback_anexos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND policyname = 'Leitura pública de anexos de feedback'
    ) THEN
        CREATE POLICY "Leitura pública de anexos de feedback"
        ON storage.objects FOR SELECT
        TO public
        USING (bucket_id = 'feedback_anexos');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND policyname = 'Service role gerencia anexos de feedback'
    ) THEN
        CREATE POLICY "Service role gerencia anexos de feedback"
        ON storage.objects FOR ALL
        TO service_role
        USING (bucket_id = 'feedback_anexos');
    END IF;
END $$;

-- Colunas opcionais na tabela feedback_diagnosticos para referência direta dos anexos
ALTER TABLE feedback_diagnosticos 
ADD COLUMN IF NOT EXISTS screenshot_url TEXT,
ADD COLUMN IF NOT EXISTS indice_url TEXT,
ADD COLUMN IF NOT EXISTS croqui_url TEXT;
