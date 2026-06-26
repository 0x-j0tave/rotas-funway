import { supabase } from './supabase'

// Bounding boxes aproximadas dos estados brasileiros
const BBOX_UF = {
  SP: { minLat: -25.3, maxLat: -19.7, minLng: -53.1, maxLng: -44.1 },
  RJ: { minLat: -23.4, maxLat: -20.7, minLng: -44.9, maxLng: -40.9 },
  MG: { minLat: -22.9, maxLat: -14.2, minLng: -51.0, maxLng: -39.8 },
  RS: { minLat: -33.8, maxLat: -27.0, minLng: -57.7, maxLng: -49.6 },
  SC: { minLat: -29.4, maxLat: -25.9, minLng: -53.9, maxLng: -48.3 },
  PR: { minLat: -26.8, maxLat: -22.5, minLng: -54.6, maxLng: -48.0 },
  CE: { minLat: -7.9,  maxLat: -2.7,  minLng: -41.4, maxLng: -37.2 },
  PE: { minLat: -9.5,  maxLat: -7.0,  minLng: -41.4, maxLng: -34.8 },
  BA: { minLat: -18.4, maxLat: -8.5,  minLng: -46.6, maxLng: -37.3 },
  DF: { minLat: -16.1, maxLat: -15.4, minLng: -48.3, maxLng: -47.3 },
  GO: { minLat: -19.5, maxLat: -12.4, minLng: -53.3, maxLng: -45.9 },
  AM: { minLat: -9.9,  maxLat: 2.2,   minLng: -73.9, maxLng: -56.1 },
  PA: { minLat: -10.0, maxLat: 2.6,   minLng: -58.9, maxLng: -46.0 },
}

function dentroDoEstado(lat, lng, uf) {
  const bbox = BBOX_UF[uf?.toUpperCase()]
  if (!bbox) return true // sem bbox definida, aceita
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng
}

async function buscarNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&countrycodes=br`
  const res = await fetch(url, { headers: { 'User-Agent': 'RotasFunway/1.0' } })
  const data = await res.json()
  return data || []
}

export async function geocodeEndereco(endereco, cidade, uf) {
  const chave = `${endereco}|${cidade}|${uf}`.toLowerCase().trim()

  // Tenta cache
  try {
    const { data: cached } = await supabase
      .from('geocode_cache')
      .select('lat, lng')
      .eq('chave', chave)
      .single()
    if (cached) return { lat: cached.lat, lng: cached.lng }
  } catch (e) {}

  await new Promise(r => setTimeout(r, 1100))

  let lat, lng

  // Tentativa 1: endereço completo com cidade e UF
  try {
    const q1 = `${endereco}, ${cidade}, ${uf}, Brasil`
    const results1 = await buscarNominatim(q1)

    for (const r of results1) {
      const rlat = parseFloat(r.lat)
      const rlng = parseFloat(r.lon)
      if (dentroDoEstado(rlat, rlng, uf)) {
        lat = rlat; lng = rlng; break
      }
    }
  } catch (e) {}

  // Tentativa 2: se não achou ou caiu fora do estado, tenta só cidade + UF + trecho do endereço
  if (!lat && endereco) {
    try {
      await new Promise(r => setTimeout(r, 1100))
      // Pega só o nome da rua sem número
      const ruaSemNumero = endereco.replace(/,?\s*\d+.*$/, '').trim()
      const q2 = `${ruaSemNumero}, ${cidade}, ${uf}, Brasil`
      const results2 = await buscarNominatim(q2)

      for (const r of results2) {
        const rlat = parseFloat(r.lat)
        const rlng = parseFloat(r.lon)
        if (dentroDoEstado(rlat, rlng, uf)) {
          lat = rlat; lng = rlng; break
        }
      }
    } catch (e) {}
  }

  // Tentativa 3: fallback para centroide da cidade
  if (!lat) {
    try {
      await new Promise(r => setTimeout(r, 1100))
      const q3 = `${cidade}, ${uf}, Brasil`
      const results3 = await buscarNominatim(q3)
      if (results3.length > 0) {
        lat = parseFloat(results3[0].lat)
        lng = parseFloat(results3[0].lon)
        console.warn(`Geocode fallback para centroide de ${cidade}: ${endereco}`)
      }
    } catch (e) {}
  }

  if (!lat) return null

  // Salva no cache
  try {
    await supabase.from('geocode_cache').upsert({ chave, lat, lng })
  } catch (e) {}

  return { lat, lng }
}
