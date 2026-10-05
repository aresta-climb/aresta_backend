-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

-- Adiciona coluna JSONB para armazenar a trilha de telemetria (breadcrumbs - últimas 50 ações)
ALTER TABLE feedback_diagnosticos 
ADD COLUMN IF NOT EXISTS breadcrumbs JSONB;
