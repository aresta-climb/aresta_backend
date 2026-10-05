-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

-- Altera o tipo da coluna breadcrumbs de JSONB para TEXT para permitir exibição de texto puro formatado com quebras de linha no painel do Supabase
ALTER TABLE feedback_diagnosticos 
ALTER COLUMN breadcrumbs TYPE TEXT USING breadcrumbs::text;
