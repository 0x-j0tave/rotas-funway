import { supabase } from './supabase'

export async function geocodeEndereco(endereco, cidade, uf) {
  const chave = `${endereco}|${cidade}|${uf}`.toLowerCase().trim()

  // Tenta buscar do cache
  const { data: cached } = await supabase
    .from('geocode_cache')
    .select('lat, lng')
    .eq('chave', chave)
    .single()

  if (cached) return { lat: cached.lat, lng: cached.lng }

  // Fallback: geocodifica via Nominatim
  const query = encodeURIComponent(`${endereco}, ${cidade}, ${uf}, Brasil`)
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OOH-Rotas/1.0' }
    })
    const data = await res.json()

    if (!data || data.length === 0) return null

    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)

    // Salva no cache
    await supabase.from('geocode_cache').upsert({ chave, lat, lng })

    return { lat, lng }
  } catch (e) {
    console.error('Erro geocodificando:', endereco, e)
    return null
  }
}
