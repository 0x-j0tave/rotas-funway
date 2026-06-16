// Calcula distância em km entre dois pontos (Haversine)
export function distancia(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// Calcula score de sobreposição de um ponto (0 a 1)
export function calcularScore(ponto, totalMarcas) {
  const sobreposicao = ponto.marcas.length / totalMarcas
  return sobreposicao
}

// Seleciona os melhores N pontos de cada ambiente por score
export function selecionarPorAmbiente(pontos, quantidadesPorAmbiente, totalMarcas) {
  const selecionados = []

  for (const [ambiente, quantidade] of Object.entries(quantidadesPorAmbiente)) {
    if (!quantidade || quantidade <= 0) continue

    const doAmbiente = pontos
      .filter(p => p.ambiente === ambiente && p.lat && p.lng)
      .map(p => ({ ...p, score: calcularScore(p, totalMarcas) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, quantidade)

    selecionados.push(...doAmbiente)
  }

  return selecionados
}

// Ordena pontos pelo menor deslocamento (nearest neighbor TSP)
export function otimizarRota(pontos) {
  if (pontos.length === 0) return []

  const visitados = new Set()
  const rota = []
  let atual = pontos[0]

  visitados.add(0)
  rota.push(atual)

  while (rota.length < pontos.length) {
    let menorDist = Infinity
    let proximoIdx = -1

    pontos.forEach((p, i) => {
      if (visitados.has(i)) return
      const d = distancia(atual, p)
      if (d < menorDist) {
        menorDist = d
        proximoIdx = i
      }
    })

    if (proximoIdx === -1) break
    visitados.add(proximoIdx)
    atual = pontos[proximoIdx]
    rota.push(atual)
  }

  return rota
}

// Gera link do Google Maps com waypoints
export function gerarLinkGoogleMaps(pontos) {
  if (pontos.length === 0) return ''
  if (pontos.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${pontos[0].lat},${pontos[0].lng}`
  }

  const origem = `${pontos[0].lat},${pontos[0].lng}`
  const destino = `${pontos[pontos.length - 1].lat},${pontos[pontos.length - 1].lng}`
  const waypoints = pontos
    .slice(1, -1)
    .map(p => `${p.lat},${p.lng}`)
    .join('|')

  return `https://www.google.com/maps/dir/?api=1&origin=${origem}&destination=${destino}&waypoints=${waypoints}&travelmode=driving`
}
