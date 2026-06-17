-- Tabela para armazenar metadados dos Excels enviados
CREATE TABLE IF NOT EXISTS excels_salvos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_marca TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  total_pontos INTEGER DEFAULT 0,
  cidades TEXT[], -- cidades encontradas no arquivo
  criado_em TIMESTAMP DEFAULT now(),
  expira_em TIMESTAMP DEFAULT (now() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_excels_expira ON excels_salvos(expira_em);
CREATE INDEX IF NOT EXISTS idx_excels_criado ON excels_salvos(criado_em DESC);

ALTER TABLE excels_salvos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso_publico_excels" ON excels_salvos FOR ALL USING (true) WITH CHECK (true);

-- Função para limpar excels expirados (rodar periodicamente)
CREATE OR REPLACE FUNCTION limpar_excels_expirados()
RETURNS void AS $$
BEGIN
  DELETE FROM excels_salvos WHERE expira_em < now();
END;
$$ LANGUAGE plpgsql;
