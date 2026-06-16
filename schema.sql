-- Schema OOH Rotas
-- Execute este SQL no Supabase SQL Editor

-- Cache de geocodificação (evita reconsultar o Nominatim)
CREATE TABLE IF NOT EXISTS geocode_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave TEXT UNIQUE NOT NULL,
  lat FLOAT NOT NULL,
  lng FLOAT NOT NULL,
  criado_em TIMESTAMP DEFAULT now()
);

-- Rotas salvas
CREATE TABLE IF NOT EXISTS rotas_salvas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cidade TEXT,
  parametros JSONB,
  pontos_json JSONB,
  criado_em TIMESTAMP DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_geocode_chave ON geocode_cache(chave);
CREATE INDEX IF NOT EXISTS idx_rotas_cidade ON rotas_salvas(cidade);
CREATE INDEX IF NOT EXISTS idx_rotas_criado ON rotas_salvas(criado_em DESC);

-- Políticas de acesso público (sem autenticação por enquanto)
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotas_salvas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso_publico_geocode" ON geocode_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_rotas" ON rotas_salvas FOR ALL USING (true) WITH CHECK (true);
