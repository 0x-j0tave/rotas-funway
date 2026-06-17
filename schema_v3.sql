-- Feedback de outliers por cidade+ambiente
CREATE TABLE IF NOT EXISTS feedback_outliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidade TEXT NOT NULL,
  ambiente TEXT NOT NULL,
  cod_ponto TEXT NOT NULL,
  distancia_km FLOAT NOT NULL, -- distância do ponto ao centroide da rota
  criado_em TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_cidade_ambiente ON feedback_outliers(cidade, ambiente);

ALTER TABLE feedback_outliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso_publico_feedback" ON feedback_outliers FOR ALL USING (true) WITH CHECK (true);

-- View que calcula o raio máximo aprendido por cidade+ambiente
-- Usa o percentil 75 das distâncias reportadas como outlier
-- (ou seja, pontos além de 75% dos casos ruins são filtrados)
CREATE OR REPLACE VIEW raio_aprendido AS
SELECT
  cidade,
  ambiente,
  COUNT(*) as total_feedbacks,
  ROUND(AVG(distancia_km)::numeric, 2) as distancia_media_km,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY distancia_km)::numeric, 2) as raio_maximo_km
FROM feedback_outliers
GROUP BY cidade, ambiente
HAVING COUNT(*) >= 1;
