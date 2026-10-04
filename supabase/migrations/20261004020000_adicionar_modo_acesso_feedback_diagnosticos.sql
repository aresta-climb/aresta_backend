-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

-- Adiciona coluna para registrar o modo de acesso do croqui ('online' sob demanda vs 'offline' baixado)
ALTER TABLE feedback_diagnosticos 
ADD COLUMN IF NOT EXISTS modo_acesso_croqui TEXT;
