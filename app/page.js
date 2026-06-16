'use client'
import { useState, useCallback } from 'react'
import { parsearExcel } from '@/lib/excel'
import { otimizarRota, gerarLinkGoogleMaps } from '@/lib/rota'
import dynamic from 'next/dynamic'

const Mapa = dynamic(() => import('@/components/Mapa'), { ssr: false })

function extrairCidades(pontos) {
  return [...new Set(pontos.map(p => p.cidade).filter(Boolean))].sort()
}

const CORES_MARCAS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'
]

export default function Home() {
  const [marcas, setMarcas] = useState([])
  const [cidadeSelecionada, setCidadeSelecionada] = useState('')
  const [cidadesDisponiveis, setCidadesDisponiveis] = useState([])
  const [ambientesDisponiveis, setAmbientesDisponiveis] = useState([])
  const [selecao, setSelecao] = useState({})
  const [rotaGerada, setRotaGerada] = useState([])
  const [linkMaps, setLinkMaps] = useState('')
  const [loading, setLoading] = useState(false)
  const [geocodingProgress, setGeocodingProgress] = useState(null)
  const [etapa, setEtapa] = useState(1)
  const [rotaSalva, setRotaSalva] = useState(false)
  const [historico, setHistorico] = useState([])
  const [mostrarHistorico, setMostrarHistorico] = useState(false)

  const corMarca = (nome) => {
    const idx = marcas.findIndex(m => m.nome === nome)
    return CORES_MARCAS[idx % CORES_MARCAS.length]
  }

  const handleUpload = useCallback(async (file, nomeMarca) => {
    const buffer = await file.arrayBuffer()
    try {
      const pontos = parsearExcel(buffer)
      setMarcas(prev => {
        const semEssa = prev.filter(m => m.nome !== nomeMarca)
        const novas = [...semEssa, { nome: nomeMarca, pontos }]
        setCidadesDisponiveis(extrairCidades(novas.flatMap(m => m.pontos)))
        return novas
      })
    } catch (err) {
      alert('Erro ao ler Excel: ' + err.message)
    }
  }, [])

  const crossMatch = useCallback((cidade) => {
    const mapa = {}
    marcas.forEach(marca => {
      marca.pontos
        .filter(p => !cidade || p.cidade === cidade)
        .forEach(p => {
          const key = p.cod_ponto
          if (!key) return
          if (!mapa[key]) mapa[key] = { ...p, marcas: [] }
          if (!mapa[key].marcas.includes(marca.nome)) mapa[key].marcas.push(marca.nome)
        })
    })
    return Object.values(mapa)
  }, [marcas])

  const handleCidade = (cidade) => {
    setCidadeSelecionada(cidade)
    const todosPontos = marcas.flatMap(m => m.pontos)
    const filtrados = cidade ? todosPontos.filter(p => p.cidade === cidade) : todosPontos
    const ambientes = [...new Set(filtrados.map(p => p.ambiente).filter(Boolean))].sort()
    setAmbientesDisponiveis(ambientes)
    setSelecao({})
  }

  const setQtd = (ambiente, marca, valor) => {
    setSelecao(prev => ({
      ...prev,
      [ambiente]: { ...(prev[ambiente] || {}), [marca]: parseInt(valor) || 0 }
    }))
  }

  const pontosCruzados = cidadeSelecionada ? crossMatch(cidadeSelecionada) : []
  const disponivelPorAmbienteMarca = {}
  pontosCruzados.forEach(p => {
    if (!disponivelPorAmbienteMarca[p.ambiente]) disponivelPorAmbienteMarca[p.ambiente] = {}
    p.marcas.forEach(m => {
      disponivelPorAmbienteMarca[p.ambiente][m] = (disponivelPorAmbienteMarca[p.ambiente][m] || 0) + 1
    })
  })

  const totalPontos = Object.values(selecao).reduce((total, porMarca) =>
    total + Object.values(porMarca).reduce((a, b) => a + (parseInt(b) || 0), 0), 0)

  const geocodificar = async (pontos) => {
    const resultado = []
    let done = 0
    for (const ponto of pontos) {
      setGeocodingProgress(`Geocodificando ${++done} de ${pontos.length}...`)
      try {
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endereco: ponto.endereco, cidade: ponto.cidade, uf: ponto.uf })
        })
        const geo = await res.json()
        if (geo && geo.lat) resultado.push({ ...ponto, lat: geo.lat, lng: geo.lng })
      } catch (e) { console.warn('Erro geocodificando:', ponto.endereco) }
      await new Promise(r => setTimeout(r, 1100))
    }
    return resultado
  }

  const gerarRota = async () => {
    setLoading(true)
    setGeocodingProgress('Preparando pontos...')
    try {
      const todosPontos = crossMatch(cidadeSelecionada)

      // ALGORITMO DE SELEÇÃO EM 2 FASES:
      //
      // Fase 1 — Pontos compartilhados (maior sobreposição primeiro)
      //   Para cada ambiente, identifica quais marcas têm cotas e qual é a menor.
      //   Seleciona até (menor cota) pontos que atendem TODAS as marcas com cota > 0.
      //   Esses pontos entram na rota com label de todas as marcas.
      //
      // Fase 2 — Complemento por proximidade
      //   Para cada marca que ainda tem vagas, completa com pontos exclusivos
      //   priorizando os mais próximos do centroide dos pontos já selecionados.

      const acumulado = {} // cod_ponto → ponto enriquecido

      for (const [ambiente, porMarca] of Object.entries(selecao)) {
        const marcasComCota = Object.entries(porMarca)
          .filter(([, q]) => (parseInt(q) || 0) > 0)
          .map(([m, q]) => ({ nome: m, qtd: parseInt(q) }))

        if (marcasComCota.length === 0) continue

        const cotaMinima = Math.min(...marcasComCota.map(m => m.qtd))

        // ── FASE 1: pontos que aparecem em TODAS as marcas com cota ──
        const nomesMarcas = marcasComCota.map(m => m.nome)
        const compartilhados = todosPontos
          .filter(p =>
            p.ambiente === ambiente &&
            nomesMarcas.every(nm => p.marcas.includes(nm))
          )
          .sort((a, b) => b.marcas.length - a.marcas.length)
          .slice(0, cotaMinima)

        compartilhados.forEach(p => {
          acumulado[p.cod_ponto] = { ...p }
        })

        // ── FASE 2: completa cota restante de cada marca por proximidade ──
        // Calcula centroide dos pontos já selecionados (para proximidade)
        // Como ainda não temos coords aqui, usamos posição na lista como proxy —
        // a ordenação real por distância acontece depois da geocodificação.
        // Por enquanto, completamos com pontos exclusivos da marca ordenados
        // por sobreposição com outras marcas (qualidade), não por coords.

        for (const { nome: nomeMarca, qtd } of marcasComCota) {
          const jaUsados = compartilhados.filter(p => p.marcas.includes(nomeMarca)).length
          const faltam = qtd - jaUsados
          if (faltam <= 0) continue

          // Pontos desta marca neste ambiente que ainda não estão na rota
          const candidatos = todosPontos
            .filter(p =>
              p.ambiente === ambiente &&
              p.marcas.includes(nomeMarca) &&
              !acumulado[p.cod_ponto]
            )
            .sort((a, b) => b.marcas.length - a.marcas.length)

          let adicionados = 0
          for (const p of candidatos) {
            if (adicionados >= faltam) break
            acumulado[p.cod_ponto] = { ...p }
            adicionados++
          }
        }
      }
      const fase1 = Object.values(acumulado)
      if (fase1.length === 0) {
        alert('Nenhum ponto selecionado.')
        setLoading(false); setGeocodingProgress(null); return
      }

      // Geocodifica pontos da Fase 1
      const geocFase1 = await geocodificar(fase1)
      if (geocFase1.length === 0) {
        alert('Nenhum ponto foi geocodificado.')
        setLoading(false); setGeocodingProgress(null); return
      }

      // Calcula centroide dos pontos da Fase 1
      const centroide = {
        lat: geocFase1.reduce((s, p) => s + p.lat, 0) / geocFase1.length,
        lng: geocFase1.reduce((s, p) => s + p.lng, 0) / geocFase1.length
      }

      // FASE 2 com coords: reseleciona complementos por proximidade ao centroide
      // Para cada marca com vagas restantes, ordena candidatos por distância ao centroide
      const codsFase1 = new Set(geocFase1.map(p => p.cod_ponto))
      const acumuladoFinal = {}
      geocFase1.forEach(p => { acumuladoFinal[p.cod_ponto] = p })

      for (const [ambiente, porMarca] of Object.entries(selecao)) {
        const marcasComCota = Object.entries(porMarca)
          .filter(([, q]) => (parseInt(q) || 0) > 0)
          .map(([m, q]) => ({ nome: m, qtd: parseInt(q) }))

        for (const { nome: nomeMarca, qtd } of marcasComCota) {
          const jaUsados = Object.values(acumuladoFinal)
            .filter(p => p.ambiente === ambiente && p.marcas?.includes(nomeMarca)).length
          const faltam = qtd - jaUsados
          if (faltam <= 0) continue

          // Candidatos não geocodificados ainda
          const candidatosBrutos = todosPontos.filter(p =>
            p.ambiente === ambiente &&
            p.marcas.includes(nomeMarca) &&
            !acumuladoFinal[p.cod_ponto]
          )

          if (candidatosBrutos.length === 0) continue

          // Geocodifica candidatos (com rate limit)
          setGeocodingProgress(`Buscando complementos para ${nomeMarca}...`)
          const geocCandidatos = await geocodificar(candidatosBrutos.slice(0, Math.min(faltam * 3, 15)))

          // Ordena por distância ao centroide
          function dist(a, b) {
            const dLat = (b.lat - a.lat) * Math.PI / 180
            const dLng = (b.lng - a.lng) * Math.PI / 180
            const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2
            return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
          }

          geocCandidatos
            .sort((a, b) => dist(centroide, a) - dist(centroide, b))
            .slice(0, faltam)
            .forEach(p => { acumuladoFinal[p.cod_ponto] = p })
        }
      }

      const geocodificados = Object.values(acumuladoFinal)
      const rotaOtimizada = otimizarRota(geocodificados)
      setRotaGerada(rotaOtimizada)
      setLinkMaps(gerarLinkGoogleMaps(rotaOtimizada))
      setEtapa(3)
    } catch (err) { alert('Erro: ' + err.message) }
    setLoading(false); setGeocodingProgress(null)
  }

  const salvarRota = async () => {
    const nome = prompt('Nome para salvar esta rota:')
    if (!nome) return
    await fetch('/api/rotas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, cidade: cidadeSelecionada, parametros: selecao, pontos: rotaGerada })
    })
    setRotaSalva(true)
    alert('Rota salva!')
  }

  const carregarHistorico = async () => {
    const res = await fetch('/api/rotas')
    setHistorico(await res.json())
    setMostrarHistorico(true)
  }

  const exportarCSV = () => {
    const linhas = [
      ['#', 'Nome do Ponto', 'Endereço', 'Ambiente', 'Marcas', 'Lat', 'Lng'],
      ...rotaGerada.map((p, i) => [i + 1, p.nome_ponto, p.endereco, p.ambiente, p.marcas?.join(' | '), p.lat, p.lng])
    ]
    const csv = linhas.map(l => l.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rota_${cidadeSelecionada}_${Date.now()}.csv`
    a.click()
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1117', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#1a1d27', borderBottom: '1px solid #2d3148', padding: '16px 32px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🗺️</div>
            <h1 style={{ fontSize: '16px', fontWeight: '600', color: '#f1f5f9', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
              Descomplicando Rotas Funway
            </h1>
          </div>
          <button onClick={carregarHistorico}
            style={{ fontSize: '13px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '500' }}>
            Ver histórico
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Histórico */}
        {mostrarHistorico && (
          <div style={{ backgroundColor: '#1a1d27', border: '1px solid #2d3148', borderRadius: '16px', padding: '20px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '600', color: '#f1f5f9' }}>Rotas salvas</h2>
              <button onClick={() => setMostrarHistorico(false)} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            {historico.length === 0 ? (
              <p style={{ color: '#475569', fontSize: '13px' }}>Nenhuma rota salva ainda.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {historico.map(r => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#0f1117', borderRadius: '10px', border: '1px solid #2d3148' }}>
                    <div>
                      <p style={{ fontSize: '13px', fontWeight: '500', color: '#e2e8f0' }}>{r.nome}</p>
                      <p style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{r.cidade} · {new Date(r.criado_em).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <button onClick={() => {
                      setRotaGerada(r.pontos_json)
                      setLinkMaps(gerarLinkGoogleMaps(r.pontos_json))
                      setCidadeSelecionada(r.cidade)
                      setEtapa(3)
                      setMostrarHistorico(false)
                    }} style={{ fontSize: '12px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '500' }}>Abrir →</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
          {[{ n: 1, label: 'Upload' }, { n: 2, label: 'Parâmetros' }, { n: 3, label: 'Rota' }].map(({ n, label }, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '12px', fontWeight: '700',
                backgroundColor: etapa >= n ? '#6366f1' : '#1e2235',
                color: etapa >= n ? '#fff' : '#475569',
                border: etapa >= n ? 'none' : '1px solid #2d3148'
              }}>{n}</div>
              <span style={{ fontSize: '13px', fontWeight: '500', color: etapa >= n ? '#e2e8f0' : '#475569' }}>{label}</span>
              {i < 2 && <div style={{ width: '32px', height: '1px', backgroundColor: '#2d3148' }} />}
            </div>
          ))}
        </div>

        {/* ETAPA 1 — Upload */}
        {etapa === 1 && (
          <div style={{ backgroundColor: '#1a1d27', border: '1px solid #2d3148', borderRadius: '16px', padding: '28px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '600', color: '#f1f5f9', marginBottom: '6px' }}>Upload das listas de pontos</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '24px' }}>Suba um Excel por marca. Você pode adicionar quantas marcas quiser.</p>

            {marcas.map((marca, idx) => (
              <div key={marca.nome} style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                backgroundColor: '#0f1117', borderRadius: '10px', border: '1px solid #2d3148',
                marginBottom: '10px'
              }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: CORES_MARCAS[idx % CORES_MARCAS.length], flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{marca.nome}</p>
                  <p style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{marca.pontos.length} pontos carregados</p>
                </div>
                <button onClick={() => setMarcas(prev => {
                  const novas = prev.filter(m => m.nome !== marca.nome)
                  setCidadesDisponiveis(extrairCidades(novas.flatMap(m => m.pontos)))
                  return novas
                })} style={{ fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Remover</button>
              </div>
            ))}

            <AddMarca onAdd={handleUpload} />

            {marcas.length > 0 && (
              <button onClick={() => setEtapa(2)} style={{
                marginTop: '24px', width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: 'white', border: 'none', borderRadius: '10px',
                fontSize: '14px', fontWeight: '600', cursor: 'pointer'
              }}>
                Continuar com {marcas.length} marca{marcas.length > 1 ? 's' : ''} →
              </button>
            )}
          </div>
        )}

        {/* ETAPA 2 — Parâmetros */}
        {etapa === 2 && (
          <div style={{ backgroundColor: '#1a1d27', border: '1px solid #2d3148', borderRadius: '16px', padding: '28px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '600', color: '#f1f5f9', marginBottom: '6px' }}>Parâmetros da rota</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '24px' }}>Selecione a cidade e quantos pontos de cada marca e ativo deseja na rota.</p>

            {/* Cidade */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cidade</label>
              <select value={cidadeSelecionada} onChange={e => handleCidade(e.target.value)} style={{
                width: '100%', padding: '10px 14px', backgroundColor: '#0f1117',
                border: '1px solid #2d3148', borderRadius: '8px', color: '#e2e8f0',
                fontSize: '13px', cursor: 'pointer', outline: 'none'
              }}>
                <option value="">Selecione uma cidade</option>
                {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Ambientes × Marcas */}
            {cidadeSelecionada && ambientesDisponiveis.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                {ambientesDisponiveis.map(amb => (
                  <div key={amb} style={{ backgroundColor: '#0f1117', border: '1px solid #2d3148', borderRadius: '12px', padding: '16px' }}>
                    <p style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{amb}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {marcas.map((marca, idx) => {
                        const disponiveis = disponivelPorAmbienteMarca[amb]?.[marca.nome] || 0
                        const cor = CORES_MARCAS[idx % CORES_MARCAS.length]
                        return (
                          <div key={marca.nome} style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: disponiveis === 0 ? 0.3 : 1 }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: cor, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <p style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: '500' }}>{marca.nome}</p>
                              <p style={{ fontSize: '11px', color: '#475569' }}>{disponiveis} disponíveis</p>
                            </div>
                            <input
                              type="number" min="0" max={disponiveis}
                              value={selecao[amb]?.[marca.nome] || ''}
                              onChange={e => setQtd(amb, marca.nome, e.target.value)}
                              disabled={disponiveis === 0}
                              placeholder="0"
                              style={{
                                width: '64px', padding: '6px 10px', textAlign: 'center',
                                backgroundColor: '#1a1d27', border: `1px solid ${selecao[amb]?.[marca.nome] > 0 ? cor : '#2d3148'}`,
                                borderRadius: '8px', color: '#e2e8f0', fontSize: '13px',
                                outline: 'none', fontWeight: '600'
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {totalPontos > 0 && (
                  <div style={{ padding: '12px 16px', backgroundColor: '#1e1b4b', borderRadius: '10px', border: '1px solid #4338ca' }}>
                    <p style={{ fontSize: '13px', color: '#a5b4fc', fontWeight: '500' }}>
                      Total estimado: <strong style={{ color: '#818cf8' }}>{totalPontos} ponto{totalPontos > 1 ? 's' : ''}</strong>
                      <span style={{ color: '#6366f1', marginLeft: '4px' }}>(pode ser menor após deduplicação)</span>
                    </p>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setEtapa(1)} style={{
                flex: 1, padding: '14px', backgroundColor: 'transparent',
                border: '1px solid #2d3148', borderRadius: '10px', color: '#94a3b8',
                fontSize: '14px', fontWeight: '500', cursor: 'pointer'
              }}>← Voltar</button>
              <button onClick={gerarRota} disabled={!cidadeSelecionada || totalPontos === 0 || loading} style={{
                flex: 1, padding: '14px',
                background: (!cidadeSelecionada || totalPontos === 0 || loading) ? '#1e2235' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none', borderRadius: '10px', color: (!cidadeSelecionada || totalPontos === 0 || loading) ? '#475569' : 'white',
                fontSize: '14px', fontWeight: '600', cursor: (!cidadeSelecionada || totalPontos === 0 || loading) ? 'not-allowed' : 'pointer'
              }}>
                {loading ? (geocodingProgress || 'Gerando...') : 'Gerar rota →'}
              </button>
            </div>
          </div>
        )}

        {/* ETAPA 3 — Resultado */}
        {etapa === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Card do mapa */}
            <div style={{ backgroundColor: '#1a1d27', border: '1px solid #2d3148', borderRadius: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: '600', color: '#f1f5f9' }}>Rota gerada</h2>
                  <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{cidadeSelecionada} · {rotaGerada.length} pontos</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => { setEtapa(2); setRotaGerada([]); setRotaSalva(false) }} style={{
                    padding: '7px 14px', backgroundColor: 'transparent', border: '1px solid #2d3148',
                    borderRadius: '8px', color: '#94a3b8', fontSize: '12px', cursor: 'pointer', fontWeight: '500'
                  }}>Ajustar</button>
                  <button onClick={salvarRota} disabled={rotaSalva} style={{
                    padding: '7px 14px', background: rotaSalva ? '#1e2235' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none', borderRadius: '8px', color: rotaSalva ? '#475569' : 'white',
                    fontSize: '12px', cursor: rotaSalva ? 'default' : 'pointer', fontWeight: '600'
                  }}>{rotaSalva ? 'Salva ✓' : 'Salvar'}</button>
                </div>
              </div>

              <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #2d3148', marginBottom: '16px', height: '460px' }}>
                <Mapa pontos={rotaGerada} />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <a href={linkMaps} target="_blank" rel="noopener noreferrer" style={{
                  flex: 1, padding: '12px', backgroundColor: '#064e3b', border: '1px solid #065f46',
                  borderRadius: '10px', color: '#34d399', fontSize: '13px', fontWeight: '600',
                  textAlign: 'center', textDecoration: 'none', display: 'block'
                }}>🗺️ Abrir no Google Maps</a>
                <button onClick={exportarCSV} style={{
                  flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #2d3148',
                  borderRadius: '10px', color: '#94a3b8', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
                }}>📥 Exportar CSV</button>
              </div>
            </div>

            {/* Lista de pontos */}
            <div style={{ backgroundColor: '#1a1d27', border: '1px solid #2d3148', borderRadius: '16px', padding: '20px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>Pontos da rota</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {rotaGerada.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 14px', backgroundColor: '#0f1117', borderRadius: '10px', border: '1px solid #2d3148' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%',
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      color: 'white', fontSize: '11px', fontWeight: '700',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome_ponto || p.endereco}</p>
                      <p style={{ fontSize: '11px', color: '#475569', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.endereco}</p>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', backgroundColor: '#1e1b4b', color: '#a5b4fc', padding: '2px 8px', borderRadius: '20px', fontWeight: '500' }}>{p.ambiente}</span>
                        {p.marcas?.map((m, mi) => (
                          <span key={m} style={{
                            fontSize: '11px', padding: '2px 8px', borderRadius: '20px', fontWeight: '500',
                            backgroundColor: `${CORES_MARCAS[marcas.findIndex(mk => mk.nome === m) % CORES_MARCAS.length]}22`,
                            color: CORES_MARCAS[marcas.findIndex(mk => mk.nome === m) % CORES_MARCAS.length]
                          }}>{m}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => { setEtapa(1); setMarcas([]); setRotaGerada([]); setCidadeSelecionada(''); setSelecao({}); setRotaSalva(false) }}
              style={{ color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '8px' }}>
              + Nova rota do zero
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function AddMarca({ onAdd }) {
  const [nome, setNome] = useState('')
  const [file, setFile] = useState(null)

  const handleSubmit = () => {
    if (!nome.trim() || !file) { alert('Preencha o nome da marca e selecione o arquivo.'); return }
    onAdd(file, nome.trim())
    setNome('')
    setFile(null)
  }

  return (
    <div style={{ border: '1px dashed #2d3148', borderRadius: '12px', padding: '16px', marginTop: '4px' }}>
      <p style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Adicionar marca</p>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Nome da marca (ex: Guaraná)" value={nome} onChange={e => setNome(e.target.value)}
          style={{
            flex: 1, minWidth: '160px', padding: '9px 14px', backgroundColor: '#0f1117',
            border: '1px solid #2d3148', borderRadius: '8px', color: '#e2e8f0',
            fontSize: '13px', outline: 'none'
          }} />
        <label style={{
          flex: 1, minWidth: '160px', cursor: 'pointer', padding: '9px 14px',
          backgroundColor: '#0f1117', border: '1px solid #2d3148', borderRadius: '8px',
          color: file ? '#a5b4fc' : '#475569', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <span>📎</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file ? file.name : 'Selecionar Excel'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
        </label>
        <button onClick={handleSubmit} style={{
          padding: '9px 20px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          border: 'none', borderRadius: '8px', color: 'white', fontSize: '13px',
          fontWeight: '600', cursor: 'pointer'
        }}>Adicionar</button>
      </div>
    </div>
  )
}
