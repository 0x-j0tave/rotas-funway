'use client'
import { useEffect, useRef, useState } from 'react'

export default function Mapa({ pontos }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [pronto, setPronto] = useState(false)

  // Marca pronto após montagem com delay para garantir dimensões
  useEffect(() => {
    const t = setTimeout(() => setPronto(true), 200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!pronto || !pontos || pontos.length === 0 || !containerRef.current) return

    import('leaflet').then(L => {
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      })

      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

      const el = containerRef.current
      // Garante dimensões explícitas no elemento antes de inicializar
      el.style.width = el.offsetWidth + 'px'
      el.style.height = '480px'

      const map = L.map(el)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
      }).addTo(map)

      const bounds = []
      pontos.forEach((p, i) => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#f97316;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5)">${i + 1}</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13]
        })
        L.marker([p.lat, p.lng], { icon }).addTo(map)
          .bindPopup(`<b>${i + 1}. ${p.nome_ponto || p.endereco}</b><br/><small>${p.ambiente}</small>`)
        bounds.push([p.lat, p.lng])
      })

      L.polyline(bounds, { color: '#f97316', weight: 3, opacity: 0.8, dashArray: '8,5' }).addTo(map)
      map.fitBounds(bounds, { padding: [40, 40] })

      // Remove width fixo e invalida para responsividade
      el.style.width = ''
      map.invalidateSize()
    })

    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [pronto, pontos])

  if (!pronto) {
    return (
      <div style={{ width: '100%', height: '480px', backgroundColor: '#111', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#4b5563', fontSize: '13px' }}>Carregando mapa...</p>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '480px', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '480px' }} />
    </div>
  )
}
