-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

-- Adiciona colunas para registrar a data e timestamp de envio do feedback informadas pelo cliente
ALTER TABLE feedback_diagnosticos 
ADD COLUMN IF NOT EXISTS submitted_at TEXT,
ADD COLUMN IF NOT EXISTS submitted_at_timestamp TEXT;
