-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

-- Habilita Row Level Security (RLS) na tabela de controle de idempotência de feedbacks
-- garantindo que apenas a service_role (Edge Functions) e o postgres tenham acesso.
ALTER TABLE public.processed_feedbacks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.processed_feedbacks FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.processed_feedbacks TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.processed_feedbacks TO postgres;
