-- Concede permissões para a Edge Function (service_role) manipular a tabela
GRANT ALL PRIVILEGES ON TABLE public.processed_feedbacks TO service_role;
