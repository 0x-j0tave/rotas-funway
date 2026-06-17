'use client'
import { useState, useCallback, useEffect } from 'react'
import { parsearExcel } from '@/lib/excel'
import { otimizarRota, gerarLinkGoogleMaps, distancia } from '@/lib/rota'
import dynamic from 'next/dynamic'

const Mapa = dynamic(() => import('@/components/Mapa'), { ssr: false })

function normalizarCidade(str) {
  if (!str) return ''
  return str.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function extrairCidades(pontos) {
  const mapa = {}
  pontos.forEach(p => {
    if (!p.cidade) return
    const chave = normalizarCidade(p.cidade)
    if (!mapa[chave]) mapa[chave] = chave
  })
  return Object.values(mapa).sort()
}

const CORES_MARCAS = ['#f97316','#3b82f6','#10b981','#ec4899','#8b5cf6','#06b6d4','#eab308','#ef4444']

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
  // Substituição
  const [pontoSubstituindo, setPontoSubstituindo] = useState(null)
  const [candidatosSubstitutos, setCandidatosSubstitutos] = useState([])
  const [loadingSubstitutos, setLoadingSubstitutos] = useState(false)
  // Excels salvos
  const [excelsSalvos, setExcelsSalvos] = useState([])
  const [mostrarExcels, setMostrarExcels] = useState(false)
  const [salvandoExcel, setSalvandoExcel] = useState(false)

  const corMarca = (nome) => CORES_MARCAS[marcas.findIndex(m => m.nome === nome) % CORES_MARCAS.length]

  // ── Upload ──
  const processarBuffer = useCallback(async (buffer, nomeMarca) => {
    const pontos = parsearExcel(buffer)
    setMarcas(prev => {
      const semEssa = prev.filter(m => m.nome !== nomeMarca)
      const novas = [...semEssa, { nome: nomeMarca, pontos }]
      setCidadesDisponiveis(extrairCidades(novas.flatMap(m => m.pontos)))
      return novas
    })
    return pontos
  }, [])

  const handleUpload = useCallback(async (file, nomeMarca, salvar = false) => {
    const buffer = await file.arrayBuffer()
    try {
      const pontos = await processarBuffer(buffer, nomeMarca)

      if (salvar) {
        setSalvandoExcel(true)
        // Upload para Supabase Storage
        const { createClient } = await import('@supabase/supabase-js')
        const sb = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        )
        const path = `${Date.now()}_${file.name.replace(/\s/g, '_')}`
        const { error: uploadError } = await sb.storage.from('excels').upload(path, file, { upsert: false })

        if (!uploadError) {
          const cidades = [...new Set(pontos.map(p => p.cidade).filter(Boolean))]
          await fetch('/api/excels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome_marca: nomeMarca, nome_arquivo: file.name, storage_path: path, total_pontos: pontos.length, cidades })
          })
        }
        setSalvandoExcel(false)
      }
    } catch (err) {
      alert('Erro ao ler Excel: ' + err.message)
      setSalvandoExcel(false)
    }
  }, [processarBuffer])

  // ── Excels salvos ──
  const carregarExcels = async () => {
    const res = await fetch('/api/excels')
    setExcelsSalvos(await res.json())
    setMostrarExcels(true)
  }

  const usarExcelSalvo = async (excel) => {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const { data } = await sb.storage.from('excels').download(excel.storage_path)
    if (!data) { alert('Erro ao baixar arquivo'); return }
    const buffer = await data.arrayBuffer()
    await processarBuffer(buffer, excel.nome_marca)
    setMostrarExcels(false)
  }

  const deletarExcel = async (excel) => {
    if (!confirm(`Remover "${excel.nome_arquivo}"?`)) return
    await fetch('/api/excels', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: excel.id, storage_path: excel.storage_path })
    })
    setExcelsSalvos(prev => prev.filter(e => e.id !== excel.id))
  }

  // ── CrossMatch ──
  const crossMatch = useCallback((cidade) => {
    const mapa = {}
    marcas.forEach(marca => {
      marca.pontos.filter(p => !cidade || normalizarCidade(p.cidade) === normalizarCidade(cidade)).forEach(p => {
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
    const filtrados = cidade ? todosPontos.filter(p => normalizarCidade(p.cidade) === normalizarCidade(cidade)) : todosPontos
    setAmbientesDisponiveis([...new Set(filtrados.map(p => p.ambiente).filter(Boolean))].sort())
    setSelecao({})
  }

  const setQtd = (ambiente, marca, valor) => {
    setSelecao(prev => ({ ...prev, [ambiente]: { ...(prev[ambiente] || {}), [marca]: parseInt(valor) || 0 } }))
  }

  const pontosCruzados = cidadeSelecionada ? crossMatch(cidadeSelecionada) : []
  const disponivelPorAmbienteMarca = {}
  pontosCruzados.forEach(p => {
    if (!disponivelPorAmbienteMarca[p.ambiente]) disponivelPorAmbienteMarca[p.ambiente] = {}
    p.marcas.forEach(m => { disponivelPorAmbienteMarca[p.ambiente][m] = (disponivelPorAmbienteMarca[p.ambiente][m] || 0) + 1 })
  })

  const totalPontos = Object.values(selecao).reduce((t, pm) => t + Object.values(pm).reduce((a, b) => a + (parseInt(b) || 0), 0), 0)

  // ── Geocodificação ──
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
        if (geo?.lat) resultado.push({ ...ponto, lat: geo.lat, lng: geo.lng })
      } catch (e) { console.warn('Erro geocodificando:', ponto.endereco) }
      await new Promise(r => setTimeout(r, 1100))
    }
    return resultado
  }

  // ── Gerar Rota ──
  const gerarRota = async () => {
    setLoading(true)
    setGeocodingProgress('Preparando pontos...')
    try {
      const todosPontos = crossMatch(cidadeSelecionada)
      const acumulado = {}

      for (const [ambiente, porMarca] of Object.entries(selecao)) {
        const marcasComCota = Object.entries(porMarca).filter(([, q]) => (parseInt(q) || 0) > 0).map(([m, q]) => ({ nome: m, qtd: parseInt(q) }))
        if (marcasComCota.length === 0) continue
        const cotaMinima = Math.min(...marcasComCota.map(m => m.qtd))
        const nomesMarcas = marcasComCota.map(m => m.nome)

        const compartilhados = todosPontos
          .filter(p => p.ambiente === ambiente && nomesMarcas.every(nm => p.marcas.includes(nm)))
          .sort((a, b) => b.marcas.length - a.marcas.length)
          .slice(0, cotaMinima)

        compartilhados.forEach(p => { acumulado[p.cod_ponto] = { ...p } })

        for (const { nome: nomeMarca, qtd } of marcasComCota) {
          const jaUsados = compartilhados.filter(p => p.marcas.includes(nomeMarca)).length
          const faltam = qtd - jaUsados
          if (faltam <= 0) continue
          const candidatos = todosPontos.filter(p => p.ambiente === ambiente && p.marcas.includes(nomeMarca) && !acumulado[p.cod_ponto]).sort((a, b) => b.marcas.length - a.marcas.length)
          let adicionados = 0
          for (const p of candidatos) {
            if (adicionados >= faltam) break
            acumulado[p.cod_ponto] = { ...p }
            adicionados++
          }
        }
      }

      const fase1 = Object.values(acumulado)
      if (fase1.length === 0) { alert('Nenhum ponto selecionado.'); setLoading(false); setGeocodingProgress(null); return }

      const geocFase1 = await geocodificar(fase1)
      if (geocFase1.length === 0) { alert('Nenhum ponto geocodificado.'); setLoading(false); setGeocodingProgress(null); return }

      const centroide = { lat: geocFase1.reduce((s, p) => s + p.lat, 0) / geocFase1.length, lng: geocFase1.reduce((s, p) => s + p.lng, 0) / geocFase1.length }
      const acumuladoFinal = {}
      geocFase1.forEach(p => { acumuladoFinal[p.cod_ponto] = p })

      for (const [ambiente, porMarca] of Object.entries(selecao)) {
        const marcasComCota = Object.entries(porMarca).filter(([, q]) => (parseInt(q) || 0) > 0).map(([m, q]) => ({ nome: m, qtd: parseInt(q) }))
        for (const { nome: nomeMarca, qtd } of marcasComCota) {
          const jaUsados = Object.values(acumuladoFinal).filter(p => p.ambiente === ambiente && p.marcas?.includes(nomeMarca)).length
          const faltam = qtd - jaUsados
          if (faltam <= 0) continue
          const todosPontos = crossMatch(cidadeSelecionada)
          const candidatosBrutos = todosPontos.filter(p => p.ambiente === ambiente && p.marcas.includes(nomeMarca) && !acumuladoFinal[p.cod_ponto])
          if (candidatosBrutos.length === 0) continue
          setGeocodingProgress(`Buscando complementos para ${nomeMarca}...`)
          const geocCandidatos = await geocodificar(candidatosBrutos.slice(0, Math.min(faltam * 3, 15)))
          geocCandidatos.sort((a, b) => distancia(centroide, a) - distancia(centroide, b)).slice(0, faltam).forEach(p => { acumuladoFinal[p.cod_ponto] = p })
        }
      }

      const geocodificados = Object.values(acumuladoFinal)
      const rotaOtimizada = otimizarRota(geocodificados)
      setRotaGerada(rotaOtimizada)
      setLinkMaps(gerarLinkGoogleMaps(rotaOtimizada))
      setEtapa(3)
    } catch (err) { alert('Erro: ' + err.message) }
    setLoading(false)
    setGeocodingProgress(null)
  }

  // ── Substituição de ponto ──
  const iniciarSubstituicao = async (ponto, idx) => {
    setPontoSubstituindo({ ponto, idx })
    setLoadingSubstitutos(true)
    setCandidatosSubstitutos([])

    const codsNaRota = new Set(rotaGerada.map(p => p.cod_ponto))
    const todosPontos = crossMatch(cidadeSelecionada)

    // Candidatos: mesmo ambiente, alguma das mesmas marcas, não na rota
    const candidatos = todosPontos
      .filter(p => p.ambiente === ponto.ambiente && !codsNaRota.has(p.cod_ponto) && p.marcas.some(m => ponto.marcas?.includes(m)))
      .sort((a, b) => b.marcas.length - a.marcas.length)
      .slice(0, 12)

    const geocodificados = await geocodificar(candidatos)
    // Ordena por distância ao ponto substituído
    geocodificados.sort((a, b) => distancia(ponto, a) - distancia(ponto, b))
    setCandidatosSubstitutos(geocodificados)
    setLoadingSubstitutos(false)
  }

  const confirmarSubstituicao = (novoPonto) => {
    const novaRota = [...rotaGerada]
    novaRota[pontoSubstituindo.idx] = novoPonto
    const rotaOtimizada = otimizarRota(novaRota)
    setRotaGerada(rotaOtimizada)
    setLinkMaps(gerarLinkGoogleMaps(rotaOtimizada))
    setPontoSubstituindo(null)
    setCandidatosSubstitutos([])
  }

  // ── Salvar rota ──
  const salvarRota = async () => {
    const nome = prompt('Nome para salvar esta rota:')
    if (!nome) return
    await fetch('/api/rotas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, cidade: cidadeSelecionada, parametros: selecao, pontos: rotaGerada }) })
    setRotaSalva(true)
    alert('Rota salva!')
  }

  const carregarHistorico = async () => {
    const res = await fetch('/api/rotas')
    setHistorico(await res.json())
    setMostrarHistorico(true)
  }

  const exportarCSV = () => {
    const linhas = [['#', 'Nome do Ponto', 'Endereço', 'Ambiente', 'Marcas', 'Lat', 'Lng'], ...rotaGerada.map((p, i) => [i + 1, p.nome_ponto, p.endereco, p.ambiente, p.marcas?.join(' | '), p.lat, p.lng])]
    const csv = linhas.map(l => l.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `rota_${cidadeSelecionada}_${Date.now()}.csv`; a.click()
  }

  const diasRestantes = (expira) => {
    const diff = new Date(expira) - new Date()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  const s = { // shared styles
    card: { backgroundColor: '#161616', border: '1px solid #252525', borderRadius: '16px', padding: '24px' },
    cardSm: { backgroundColor: '#0d0d0d', border: '1px solid #252525', borderRadius: '12px', padding: '14px 16px' },
    label: { fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', display: 'block' },
    input: { width: '100%', padding: '10px 14px', backgroundColor: '#0d0d0d', border: '1px solid #252525', borderRadius: '8px', color: '#e5e5e5', fontSize: '13px', outline: 'none' },
    btnPrimary: { padding: '12px 20px', background: 'linear-gradient(135deg, #f97316, #ea580c)', border: 'none', borderRadius: '10px', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer', letterSpacing: '0.02em' },
    btnSecondary: { padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #252525', borderRadius: '10px', color: '#9ca3af', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
    badge: (cor) => ({ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '600', backgroundColor: cor + '20', color: cor, border: `1px solid ${cor}40` }),
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0d0d0d', color: '#e5e5e5' }}>

      {/* Header */}
      <div style={{ backgroundColor: '#111', borderBottom: '1px solid #1f1f1f', padding: '0 32px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <img src="/funway-logo.png" alt="Funway" style={{ height: '32px', width: '32px', objectFit: 'contain' }} />
            <div style={{ width: '1px', height: '20px', backgroundColor: '#2a2a2a' }} />
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#d1d5db', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Descomplicando Rotas</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={carregarExcels} style={{ ...s.btnSecondary, fontSize: '12px', padding: '7px 14px' }}>📂 Listas salvas</button>
            <button onClick={carregarHistorico} style={{ ...s.btnSecondary, fontSize: '12px', padding: '7px 14px' }}>🕐 Histórico</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Modal Excels Salvos */}
        {mostrarExcels && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
            <div style={{ ...s.card, width: '100%', maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9' }}>Listas salvas</h2>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>Arquivos ficam disponíveis por 7 dias</p>
                </div>
                <button onClick={() => setMostrarExcels(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '20px' }}>✕</button>
              </div>
              {excelsSalvos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#4b5563' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                  <p style={{ fontSize: '13px' }}>Nenhuma lista salva ainda.</p>
                  <p style={{ fontSize: '12px', marginTop: '4px' }}>Ao fazer upload, marque "Salvar por 7 dias".</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {excelsSalvos.map(e => {
                    const dias = diasRestantes(e.expira_em)
                    return (
                      <div key={e.id} style={{ ...s.cardSm, display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: dias <= 1 ? '#ef4444' : dias <= 3 ? '#f97316' : '#10b981', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '13px', fontWeight: '600', color: '#e5e5e5' }}>{e.nome_marca}</p>
                          <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{e.nome_arquivo} · {e.total_pontos} pontos · {e.cidades?.join(', ')}</p>
                          <p style={{ fontSize: '10px', color: dias <= 1 ? '#ef4444' : dias <= 3 ? '#f97316' : '#6b7280', marginTop: '2px' }}>
                            {dias === 0 ? 'Expira hoje' : `${dias} dia${dias > 1 ? 's' : ''} restante${dias > 1 ? 's' : ''}`}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => usarExcelSalvo(e)} style={{ ...s.btnPrimary, padding: '6px 12px', fontSize: '11px' }}>Usar</button>
                          <button onClick={() => deletarExcel(e)} style={{ ...s.btnSecondary, padding: '6px 12px', fontSize: '11px', color: '#ef4444', borderColor: '#ef444430' }}>✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Histórico */}
        {mostrarHistorico && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
            <div style={{ ...s.card, width: '100%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9' }}>Rotas salvas</h2>
                <button onClick={() => setMostrarHistorico(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '20px' }}>✕</button>
              </div>
              {historico.length === 0 ? <p style={{ color: '#4b5563', fontSize: '13px' }}>Nenhuma rota salva.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {historico.map(r => (
                    <div key={r.id} style={{ ...s.cardSm, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: '600', color: '#e5e5e5' }}>{r.nome}</p>
                        <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{r.cidade} · {new Date(r.criado_em).toLocaleDateString('pt-BR')} · {r.pontos_json?.length} pontos</p>
                      </div>
                      <button onClick={() => { setRotaGerada(r.pontos_json); setLinkMaps(gerarLinkGoogleMaps(r.pontos_json)); setCidadeSelecionada(r.cidade); setEtapa(3); setMostrarHistorico(false) }}
                        style={{ fontSize: '12px', color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>Abrir →</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Substituição */}
        {pontoSubstituindo && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
            <div style={{ ...s.card, width: '100%', maxWidth: '600px', maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9' }}>Substituir ponto #{pontoSubstituindo.idx + 1}</h2>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                    {pontoSubstituindo.ponto.nome_ponto || pontoSubstituindo.ponto.endereco}
                  </p>
                  <p style={{ fontSize: '11px', color: '#4b5563', marginTop: '2px' }}>{pontoSubstituindo.ponto.ambiente}</p>
                </div>
                <button onClick={() => { setPontoSubstituindo(null); setCandidatosSubstitutos([]) }} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '20px' }}>✕</button>
              </div>

              {loadingSubstitutos ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
                  <p style={{ fontSize: '13px' }}>Buscando candidatos próximos...</p>
                </div>
              ) : candidatosSubstitutos.length === 0 ? (
                <p style={{ color: '#4b5563', fontSize: '13px', textAlign: 'center', padding: '32px' }}>Nenhum substituto disponível para este ponto.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>Ordenados por proximidade ao ponto atual — {candidatosSubstitutos.length} candidatos</p>
                  {candidatosSubstitutos.map((p, i) => {
                    const dist = distancia(pontoSubstituindo.ponto, p)
                    return (
                      <div key={p.cod_ponto} style={{ ...s.cardSm, display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = '#f97316'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = '#252525'}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#1f1f1f', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: '#9ca3af', flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '13px', fontWeight: '600', color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome_ponto || p.endereco}</p>
                          <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.endereco}</p>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {p.marcas?.map(m => <span key={m} style={s.badge(corMarca(m))}>{m}</span>)}
                            <span style={{ fontSize: '10px', color: '#4b5563' }}>{dist.toFixed(1)} km</span>
                          </div>
                        </div>
                        <button onClick={() => confirmarSubstituicao(p)} style={{ ...s.btnPrimary, padding: '7px 14px', fontSize: '12px', flexShrink: 0 }}>Usar</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '28px' }}>
          {[{ n: 1, label: 'Upload' }, { n: 2, label: 'Parâmetros' }, { n: 3, label: 'Rota' }].map(({ n, label }, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '20px', backgroundColor: etapa === n ? '#1c0a00' : etapa > n ? '#0d0d0d' : '#0d0d0d', border: `1px solid ${etapa === n ? '#f97316' : etapa > n ? '#252525' : '#1f1f1f'}` }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', backgroundColor: etapa >= n ? '#f97316' : '#1f1f1f', color: etapa >= n ? 'white' : '#4b5563' }}>{etapa > n ? '✓' : n}</div>
                <span style={{ fontSize: '12px', fontWeight: '600', color: etapa === n ? '#f97316' : etapa > n ? '#6b7280' : '#4b5563' }}>{label}</span>
              </div>
              {i < 2 && <div style={{ width: '24px', height: '1px', backgroundColor: '#1f1f1f' }} />}
            </div>
          ))}
          {marcas.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
              {marcas.map((m, i) => (
                <span key={m.nome} style={{ ...s.badge(CORES_MARCAS[i % CORES_MARCAS.length]), fontSize: '11px' }}>{m.nome}</span>
              ))}
            </div>
          )}
        </div>

        {/* ETAPA 1 */}
        {etapa === 1 && (
          <div style={{ display: 'grid', gridTemplateColumns: marcas.length > 0 ? '1fr 380px' : '1fr', gap: '16px' }}>
            <div style={s.card}>
              <div style={{ marginBottom: '20px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#f1f5f9' }}>Upload das listas</h2>
                <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Suba um Excel por marca. Use "Listas salvas" para reutilizar uploads anteriores.</p>
              </div>

              {marcas.map((marca, idx) => (
                <div key={marca.nome} style={{ ...s.cardSm, display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: CORES_MARCAS[idx % CORES_MARCAS.length], flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#e5e5e5' }}>{marca.nome}</p>
                    <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{marca.pontos.length.toLocaleString()} pontos</p>
                  </div>
                  <button onClick={() => setMarcas(prev => { const novas = prev.filter(m => m.nome !== marca.nome); setCidadesDisponiveis(extrairCidades(novas.flatMap(m => m.pontos))); return novas })}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '13px', padding: '4px 8px' }}>✕</button>
                </div>
              ))}

              <AddMarca onAdd={handleUpload} />
            </div>

            {marcas.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ ...s.card, flex: 1 }}>
                  <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '16px' }}>Resumo</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>Marcas carregadas</span>
                      <span style={{ fontSize: '16px', fontWeight: '700', color: '#f97316' }}>{marcas.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>Total de pontos</span>
                      <span style={{ fontSize: '16px', fontWeight: '700', color: '#e5e5e5' }}>{marcas.reduce((s, m) => s + m.pontos.length, 0).toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>Cidades</span>
                      <span style={{ fontSize: '16px', fontWeight: '700', color: '#e5e5e5' }}>{cidadesDisponiveis.length}</span>
                    </div>
                  </div>
                  <div style={{ height: '1px', backgroundColor: '#1f1f1f', margin: '16px 0' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {cidadesDisponiveis.map(c => (
                      <div key={c} style={{ fontSize: '12px', color: '#4b5563', padding: '4px 0', borderBottom: '1px solid #1a1a1a' }}>{c}</div>
                    ))}
                  </div>
                </div>
                <button onClick={() => setEtapa(2)} style={{ ...s.btnPrimary, width: '100%', padding: '14px', fontSize: '14px' }}>
                  Definir parâmetros →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ETAPA 2 */}
        {etapa === 2 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px', alignItems: 'start' }}>
            <div style={s.card}>
              <div style={{ marginBottom: '20px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#f1f5f9' }}>Parâmetros da rota</h2>
                <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Defina quantos pontos de cada marca e ativo deseja na rota.</p>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={s.label}>Cidade</label>
                <select value={cidadeSelecionada} onChange={e => handleCidade(e.target.value)} style={{ ...s.input, cursor: 'pointer' }}>
                  <option value="">Selecione uma cidade</option>
                  {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {cidadeSelecionada && ambientesDisponiveis.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {ambientesDisponiveis.map(amb => (
                    <div key={amb} style={{ backgroundColor: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: '12px', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1f1f1f', backgroundColor: '#111' }}>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{amb}</p>
                      </div>
                      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {marcas.map((marca, idx) => {
                          const disponiveis = disponivelPorAmbienteMarca[amb]?.[marca.nome] || 0
                          const cor = CORES_MARCAS[idx % CORES_MARCAS.length]
                          const val = selecao[amb]?.[marca.nome] || 0
                          return (
                            <div key={marca.nome} style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: disponiveis === 0 ? 0.3 : 1 }}>
                              <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: cor, flexShrink: 0 }} />
                              <div style={{ flex: 1 }}>
                                <span style={{ fontSize: '13px', color: '#e5e5e5', fontWeight: '500' }}>{marca.nome}</span>
                                <span style={{ fontSize: '11px', color: '#4b5563', marginLeft: '8px' }}>{disponiveis} disponíveis</span>
                              </div>
                              <input type="number" min="0" max={disponiveis} value={val || ''} onChange={e => setQtd(amb, marca.nome, e.target.value)} disabled={disponiveis === 0} placeholder="0"
                                style={{ width: '60px', padding: '6px', textAlign: 'center', backgroundColor: '#161616', border: `1px solid ${val > 0 ? cor : '#252525'}`, borderRadius: '8px', color: val > 0 ? cor : '#9ca3af', fontSize: '14px', fontWeight: '700', outline: 'none' }} />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Painel lateral */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'sticky', top: '24px' }}>
              <div style={s.card}>
                <h3 style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '16px' }}>Resumo da seleção</h3>
                {totalPontos === 0 ? (
                  <p style={{ fontSize: '12px', color: '#4b5563', textAlign: 'center', padding: '16px 0' }}>Nenhum ponto selecionado ainda</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {Object.entries(selecao).map(([amb, porMarca]) => {
                      const total = Object.values(porMarca).reduce((a, b) => a + (parseInt(b) || 0), 0)
                      if (total === 0) return null
                      return (
                        <div key={amb} style={{ padding: '10px 12px', backgroundColor: '#0d0d0d', borderRadius: '8px', border: '1px solid #1f1f1f' }}>
                          <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px', fontWeight: '600' }}>{amb}</p>
                          {Object.entries(porMarca).filter(([, q]) => (parseInt(q) || 0) > 0).map(([m, q]) => (
                            <div key={m} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                              <span style={{ fontSize: '12px', color: '#9ca3af' }}>{m}</span>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: '#f97316' }}>{q}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                    <div style={{ padding: '10px 12px', backgroundColor: '#1c0a00', borderRadius: '8px', border: '1px solid #9a3412', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '12px', color: '#fb923c' }}>Total estimado</span>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: '#f97316' }}>{totalPontos}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => setEtapa(1)} style={{ ...s.btnSecondary, width: '100%', padding: '12px' }}>← Voltar</button>
              <button onClick={gerarRota} disabled={!cidadeSelecionada || totalPontos === 0 || loading} style={{ ...s.btnPrimary, width: '100%', padding: '14px', fontSize: '14px', opacity: (!cidadeSelecionada || totalPontos === 0 || loading) ? 0.4 : 1, cursor: (!cidadeSelecionada || totalPontos === 0 || loading) ? 'not-allowed' : 'pointer' }}>
                {loading ? (geocodingProgress || 'Gerando...') : '🗺️ Gerar rota'}
              </button>
            </div>
          </div>
        )}

        {/* ETAPA 3 */}
        {etapa === 3 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '16px', alignItems: 'start' }}>
            {/* Coluna esquerda — mapa */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#f1f5f9' }}>Rota gerada</h2>
                    <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{cidadeSelecionada} · {rotaGerada.length} pontos únicos</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => { setEtapa(2); setRotaGerada([]); setRotaSalva(false) }} style={{ ...s.btnSecondary, fontSize: '12px', padding: '7px 14px' }}>Ajustar</button>
                    <button onClick={salvarRota} disabled={rotaSalva} style={{ ...s.btnPrimary, fontSize: '12px', padding: '7px 14px', opacity: rotaSalva ? 0.5 : 1 }}>{rotaSalva ? '✓ Salva' : 'Salvar'}</button>
                  </div>
                </div>
                <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #252525', height: '480px' }}>
                  <Mapa pontos={rotaGerada} />
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                  <a href={linkMaps} target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: '11px', backgroundColor: '#052e16', border: '1px solid #14532d', borderRadius: '10px', color: '#4ade80', fontSize: '13px', fontWeight: '700', textAlign: 'center', textDecoration: 'none' }}>
                    🗺️ Abrir no Google Maps
                  </a>
                  <button onClick={exportarCSV} style={{ ...s.btnSecondary, flex: 1, padding: '11px', fontSize: '13px' }}>📥 Exportar CSV</button>
                </div>
              </div>
            </div>

            {/* Coluna direita — lista de pontos */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pontos da rota</h3>
                <span style={{ fontSize: '11px', color: '#4b5563' }}>{rotaGerada.length} pontos</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '560px', overflowY: 'auto' }}>
                {rotaGerada.map((p, i) => {
                  const sobreposicao = p.marcas?.length || 0
                  const totalMarcas = marcas.length
                  const corSob = sobreposicao === totalMarcas ? '#f97316' : sobreposicao > 1 ? '#fb923c' : '#4b5563'
                  return (
                    <div key={i} style={{ padding: '10px 12px', backgroundColor: '#0d0d0d', borderRadius: '10px', border: '1px solid #1f1f1f', transition: 'border-color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#333'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = '#1f1f1f'}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'linear-gradient(135deg, #f97316, #ea580c)', color: 'white', fontSize: '10px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '12px', fontWeight: '600', color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome_ponto || p.endereco}</p>
                          <p style={{ fontSize: '11px', color: '#4b5563', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.endereco}</p>
                          <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: '10px', backgroundColor: '#1c0a00', color: '#fb923c', padding: '2px 7px', borderRadius: '12px', fontWeight: '600' }}>{p.ambiente?.split(' ')[0]}</span>
                            {p.marcas?.map(m => <span key={m} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '12px', fontWeight: '600', backgroundColor: corMarca(m) + '20', color: corMarca(m) }}>{m}</span>)}
                            <span style={{ fontSize: '10px', fontWeight: '700', color: corSob, marginLeft: '2px' }}>{sobreposicao}/{totalMarcas}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => iniciarSubstituicao(p, i)}
                          title="Substituir ponto"
                          style={{ background: 'none', border: '1px solid #252525', borderRadius: '6px', color: '#6b7280', cursor: 'pointer', padding: '4px 8px', fontSize: '12px', flexShrink: 0 }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#6b7280' }}
                        >⇄</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {etapa === 3 && (
          <button onClick={() => { setEtapa(1); setMarcas([]); setRotaGerada([]); setCidadeSelecionada(''); setSelecao({}); setRotaSalva(false) }}
            style={{ color: '#4b5563', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '16px 0', display: 'block', width: '100%', textAlign: 'center' }}>
            + Nova rota do zero
          </button>
        )}
      </div>
    </div>
  )
}

function AddMarca({ onAdd }) {
  const [nome, setNome] = useState('')
  const [file, setFile] = useState(null)
  const [salvar, setSalvar] = useState(false)

  const handleSubmit = () => {
    if (!nome.trim() || !file) { alert('Preencha o nome da marca e selecione o arquivo.'); return }
    onAdd(file, nome.trim(), salvar)
    setNome('')
    setFile(null)
    setSalvar(false)
  }

  return (
    <div style={{ border: '1px dashed #252525', borderRadius: '12px', padding: '16px', marginTop: '8px' }}>
      <p style={{ fontSize: '11px', fontWeight: '700', color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Adicionar marca</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <input type="text" placeholder="Nome da marca" value={nome} onChange={e => setNome(e.target.value)}
          style={{ flex: 1, minWidth: '140px', padding: '9px 12px', backgroundColor: '#0d0d0d', border: '1px solid #252525', borderRadius: '8px', color: '#e5e5e5', fontSize: '13px', outline: 'none' }} />
        <label style={{ flex: 1, minWidth: '140px', cursor: 'pointer', padding: '9px 12px', backgroundColor: '#0d0d0d', border: '1px solid #252525', borderRadius: '8px', color: file ? '#f97316' : '#4b5563', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>📎</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file ? file.name : 'Selecionar Excel'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
        </label>
        <button onClick={handleSubmit} style={{ padding: '9px 18px', background: 'linear-gradient(135deg, #f97316, #ea580c)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Adicionar</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <input type="checkbox" checked={salvar} onChange={e => setSalvar(e.target.checked)}
          style={{ width: '14px', height: '14px', accentColor: '#f97316' }} />
        <span style={{ fontSize: '12px', color: '#6b7280' }}>Salvar lista por 7 dias para a equipe reutilizar</span>
      </label>
    </div>
  )
}
