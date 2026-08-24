-- Tabela de controle de branches e sugestões de croquis
CREATE TABLE IF NOT EXISTS sugestoes_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_name TEXT NOT NULL UNIQUE,
    author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    author_email TEXT NOT NULL,
    author_name TEXT NOT NULL,
    pr_number INTEGER,
    pr_url TEXT,
    status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'integrada', 'rejeitada')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de busca e unicidade
CREATE UNIQUE INDEX IF NOT EXISTS idx_sugestoes_branches_branch_name ON sugestoes_branches(branch_name);
CREATE INDEX IF NOT EXISTS idx_sugestoes_branches_author_email ON sugestoes_branches(author_email);

-- Habilitar Row Level Security (RLS)
ALTER TABLE sugestoes_branches ENABLE ROW LEVEL SECURITY;

-- Conceder permissões para a service_role (usada pelas Edge Functions)
GRANT ALL ON sugestoes_branches TO service_role;
GRANT ALL ON sugestoes_branches TO postgres;

-- Política para que usuários autenticados possam consultar suas próprias sugestões
CREATE POLICY "Usuarios podem visualizar suas proprias sugestoes" 
ON sugestoes_branches 
FOR SELECT 
TO authenticated 
USING (
    author_email = (auth.jwt() ->> 'email') 
    OR author_id = auth.uid()
);
