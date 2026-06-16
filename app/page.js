'use client'
import { useState, useCallback } from 'react'
import { parsearExcel } from '@/lib/excel'
import { otimizarRota, gerarLinkGoogleMaps } from '@/lib/rota'
import dynamic from 'next/dynamic'

const Mapa = dynamic(() => import('@/components/Mapa'), { ssr: false })

function extrairCidades(pontos) {
  return [...new Set(pontos.map(p => p.cidade).filter(Boolean))].sort()
}

export default function Home() {
  const [marcas, setMarcas] = useState([])
  const [cidadeSelecionada, setCidadeSelecionada] = useState('')
  const [cidadesDisponiveis, setCidadesDisponiveis] = useState([])
  const [ambientesDisponiveis, setAmbientesDisponiveis] = useState([])
  // { "Ambiente X": { "Marca A": 2, "Marca B": 1 } }
  const [selecao, setSelecao] = useState({})
  const [rotaGerada, setRotaGerada] = useState([])
  const [linkMaps, setLinkMaps] = useState('')
  const [loading, setLoading] = useState(false)
  const [geocodingProgress, setGeocodingProgress] = useState(null)
  const [etapa, setEtapa] = useState(1)
  const [rotaSalva, setRotaSalva] = useState(false)
  const [historico, setHistorico] = useState([])
  const [mostrarHistorico, setMostrarHistorico] = useState(false)

  const handleUpload = useCallback(async (file, nomeMarca) => {
    const buffer = await file.arrayBuffer()
    try {
      const pontos = parsearExcel(buffer)
      setMarcas(prev => {
        const semEssa = prev.filter(m => m.nome !== nomeMarca)
        const novas = [...semEssa, { nome: nomeMarca, pontos }]
        const todosPontos = novas.flatMap(m => m.pontos)
        setCidadesDisponiveis(extrairCidades(todosPontos))
        return novas
      })
    } catch (err) {
      alert('Erro ao ler Excel: ' + err.message)
    }
  }, [])

  // Cross-match: agrupa por cod_ponto somando marcas
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
      [ambiente]: {
        ...(prev[ambiente] || {}),
        [marca]: parseInt(valor) || 0
      }
    }))
  }

  // Conta pontos disponíveis por ambiente+marca (no crossMatch)
  const pontosCruzados = cidadeSelecionada ? crossMatch(cidadeSelecionada) : []

  const disponivelPorAmbienteMarca = {}
  pontosCruzados.forEach(p => {
    if (!disponivelPorAmbienteMarca[p.ambiente]) disponivelPorAmbienteMarca[p.ambiente] = {}
    p.marcas.forEach(m => {
      disponivelPorAmbienteMarca[p.ambiente][m] = (disponivelPorAmbienteMarca[p.ambiente][m] || 0) + 1
    })
  })

  // Total de pontos selecionados (após deduplicação estimada)
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
        else console.warn('Não geocodificado:', ponto.endereco)
      } catch (e) {
        console.warn('Erro geocodificando:', ponto.endereco)
      }
      await new Promise(r => setTimeout(r, 1100))
    }
    return resultado
  }

  const gerarRota = async () => {
    setLoading(true)
    setGeocodingProgress('Preparando pontos...')

    try {
      const todosPontos = crossMatch(cidadeSelecionada)
      // mapa de pontos por marca para lookup rápido
      const pontosPorMarca = {}
      marcas.forEach(marca => {
        pontosPorMarca[marca.nome] = {}
        marca.pontos
          .filter(p => !cidadeSelecionada || p.cidade === cidadeSelecionada)
          .forEach(p => { pontosPorMarca[marca.nome][p.cod_ponto] = p })
      })

      // Acumula selecionados por cod_ponto para deduplicar
      // key: cod_ponto, value: ponto com marcas acumuladas
      const acumulado = {}

      for (const [ambiente, porMarca] of Object.entries(selecao)) {
        for (const [nomeMarca, quantidade] of Object.entries(porMarca)) {
          const qtd = parseInt(quantidade) || 0
          if (qtd <= 0) continue

          // Pontos desta marca neste ambiente, ordenados por sobreposição (mais marcas = melhor)
          const candidatos = todosPontos
            .filter(p => p.ambiente === ambiente && p.marcas.includes(nomeMarca))
            .sort((a, b) => b.marcas.length - a.marcas.length)

          let adicionados = 0
          for (const p of candidatos) {
            if (adicionados >= qtd) break
            const key = p.cod_ponto
            if (!acumulado[key]) {
              acumulado[key] = { ...p }
            } else {
              // Ponto já existe — garante que a marca atual está listada
              if (!acumulado[key].marcas.includes(nomeMarca)) {
                acumulado[key].marcas.push(nomeMarca)
              }
            }
            adicionados++
          }
        }
      }

      const selecionados = Object.values(acumulado)

      if (selecionados.length === 0) {
        alert('Nenhum ponto selecionado. Verifique se as quantidades estão preenchidas.')
        setLoading(false)
        setGeocodingProgress(null)
        return
      }

      const geocodificados = await geocodificar(selecionados)

      if (geocodificados.length === 0) {
        alert('Nenhum ponto foi geocodificado.')
        setLoading(false)
        setGeocodingProgress(null)
        return
      }

      const rotaOtimizada = otimizarRota(geocodificados)
      setRotaGerada(rotaOtimizada)
      setLinkMaps(gerarLinkGoogleMaps(rotaOtimizada))
      setEtapa(3)
    } catch (err) {
      alert('Erro ao gerar rota: ' + err.message)
    }

    setLoading(false)
    setGeocodingProgress(null)
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

  const nomesAmbientesComSelecao = ambientesDisponiveis.filter(amb =>
    Object.values(selecao[amb] || {}).some(v => (parseInt(v) || 0) > 0)
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">OOH Rotas</h1>
          <p className="text-gray-500 text-sm">Sistema de rotas para campanhas OOH</p>
        </div>
        <button onClick={carregarHistorico} className="text-sm text-blue-600 hover:underline">Ver histórico</button>
      </div>

      {mostrarHistorico && (
        <div className="mb-6 bg-white rounded-xl border p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Rotas salvas</h2>
            <button onClick={() => setMostrarHistorico(false)} className="text-gray-400">✕</button>
          </div>
          {historico.length === 0 ? <p className="text-gray-400 text-sm">Nenhuma rota salva.</p> : (
            <div className="space-y-2">
              {historico.map(r => (
                <div key={r.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{r.nome}</p>
                    <p className="text-xs text-gray-400">{r.cidade} · {new Date(r.criado_em).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <button onClick={() => {
                    setRotaGerada(r.pontos_json)
                    setLinkMaps(gerarLinkGoogleMaps(r.pontos_json))
                    setCidadeSelecionada(r.cidade)
                    setEtapa(3)
                    setMostrarHistorico(false)
                  }} className="text-xs text-blue-600 hover:underline">Abrir</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${etapa >= s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'}`}>{s}</div>
            <span className={`text-sm ${etapa >= s ? 'text-gray-700' : 'text-gray-400'}`}>{s === 1 ? 'Upload' : s === 2 ? 'Parâmetros' : 'Rota'}</span>
            {s < 3 && <div className="w-8 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* ETAPA 1 */}
      {etapa === 1 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-800 mb-1">Upload das listas de pontos</h2>
          <p className="text-sm text-gray-500 mb-6">Suba um Excel por marca.</p>
          {marcas.map(marca => (
            <div key={marca.nome} className="flex items-center gap-3 mb-3 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <div className="flex-1">
                <p className="font-medium text-sm text-green-800">{marca.nome}</p>
                <p className="text-xs text-green-600">{marca.pontos.length} pontos carregados</p>
              </div>
              <button onClick={() => setMarcas(prev => {
                const novas = prev.filter(m => m.nome !== marca.nome)
                setCidadesDisponiveis(extrairCidades(novas.flatMap(m => m.pontos)))
                return novas
              })} className="text-xs text-red-400 hover:text-red-600">Remover</button>
            </div>
          ))}
          <AddMarca onAdd={handleUpload} />
          {marcas.length > 0 && (
            <button onClick={() => setEtapa(2)} className="mt-6 w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition">
              Continuar com {marcas.length} marca{marcas.length > 1 ? 's' : ''} →
            </button>
          )}
        </div>
      )}

      {/* ETAPA 2 */}
      {etapa === 2 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-800 mb-1">Parâmetros da rota</h2>
          <p className="text-sm text-gray-500 mb-6">Selecione a cidade e quantos pontos de cada marca e ativo deseja na rota.</p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Cidade</label>
            <select value={cidadeSelecionada} onChange={e => handleCidade(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecione uma cidade</option>
              {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {cidadeSelecionada && ambientesDisponiveis.length > 0 && (
            <div className="mb-6 space-y-6">
              {ambientesDisponiveis.map(amb => (
                <div key={amb} className="border rounded-xl p-4">
                  <p className="font-medium text-gray-800 mb-3">{amb}</p>
                  <div className="space-y-3">
                    {marcas.map(marca => {
                      const disponiveis = disponivelPorAmbienteMarca[amb]?.[marca.nome] || 0
                      if (disponiveis === 0) return (
                        <div key={marca.nome} className="flex items-center gap-4 opacity-40">
                          <div className="flex-1">
                            <p className="text-sm text-gray-500">{marca.nome}</p>
                            <p className="text-xs text-gray-400">Sem pontos neste ativo</p>
                          </div>
                          <div className="w-20 text-center text-xs text-gray-300">—</div>
                        </div>
                      )
                      return (
                        <div key={marca.nome} className="flex items-center gap-4">
                          <div className="flex-1">
                            <p className="text-sm text-gray-700">{marca.nome}</p>
                            <p className="text-xs text-gray-400">{disponiveis} pontos disponíveis</p>
                          </div>
                          <input
                            type="number" min="0" max={disponiveis}
                            value={selecao[amb]?.[marca.nome] || ''}
                            onChange={e => setQtd(amb, marca.nome, e.target.value)}
                            placeholder="0"
                            className="w-20 border rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {totalPontos > 0 && (
                <p className="text-sm text-blue-600 font-medium">
                  Total estimado: {totalPontos} ponto{totalPontos > 1 ? 's' : ''} (pode ser menor após deduplicação de pontos compartilhados entre marcas)
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setEtapa(1)} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">← Voltar</button>
            <button onClick={gerarRota} disabled={!cidadeSelecionada || totalPontos === 0 || loading}
              className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? (geocodingProgress || 'Gerando...') : 'Gerar rota →'}
            </button>
          </div>
        </div>
      )}

      {/* ETAPA 3 */}
      {etapa === 3 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-800">Rota gerada</h2>
                <p className="text-sm text-gray-500">{cidadeSelecionada} · {rotaGerada.length} ponto{rotaGerada.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEtapa(2); setRotaGerada([]); setRotaSalva(false) }}
                  className="text-sm border px-3 py-1.5 rounded-lg hover:bg-gray-50">Ajustar</button>
                <button onClick={salvarRota} disabled={rotaSalva}
                  className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {rotaSalva ? 'Salva ✓' : 'Salvar'}
                </button>
              </div>
            </div>
            <div className="rounded-lg overflow-hidden border mb-4">
              <Mapa pontos={rotaGerada} />
            </div>
            <div className="flex gap-3">
              <a href={linkMaps} target="_blank" rel="noopener noreferrer"
                className="flex-1 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium text-center hover:bg-green-700 transition">
                🗺️ Abrir no Google Maps
              </a>
              <button onClick={exportarCSV}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
                📥 Exportar CSV
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-medium text-gray-800 mb-3">Pontos da rota</h3>
            <div className="space-y-2">
              {rotaGerada.map((p, i) => (
                <div key={i} className="flex gap-3 items-start p-3 bg-gray-50 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.nome_ponto || p.endereco}</p>
                    <p className="text-xs text-gray-500 truncate">{p.endereco}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{p.ambiente}</span>
                      {p.marcas?.map(m => <span key={m} className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{m}</span>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => { setEtapa(1); setMarcas([]); setRotaGerada([]); setCidadeSelecionada(''); setSelecao({}); setRotaSalva(false) }}
            className="w-full text-sm text-gray-500 hover:text-gray-700 py-2">
            + Nova rota do zero
          </button>
        </div>
      )}
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
    <div className="border-2 border-dashed border-gray-200 rounded-xl p-4">
      <p className="text-sm font-medium text-gray-700 mb-3">Adicionar marca</p>
      <div className="flex gap-3 flex-wrap">
        <input type="text" placeholder="Nome da marca (ex: Guaraná)" value={nome} onChange={e => setNome(e.target.value)}
          className="flex-1 min-w-40 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <label className="flex-1 min-w-40 cursor-pointer border rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 flex items-center gap-2">
          <span>📎</span>
          <span className="truncate">{file ? file.name : 'Selecionar Excel'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => setFile(e.target.files[0])} />
        </label>
        <button onClick={handleSubmit} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">Adicionar</button>
      </div>
    </div>
  )
}
