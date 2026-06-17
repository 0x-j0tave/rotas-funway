'use client'
import { useEffect, useRef } from 'react'

export default function Mapa({ pontos }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !pontos || pontos.length === 0) return

    import('leaflet').then(L => {
      // Fix ícones
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      })

      // Destrói instância anterior
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }

      // Garante que o container tem dimensões antes de inicializar
      const container = containerRef.current
      container.style.height = '480px'
      container.style.width = '100%'

      const map = L.map(container, { zoomControl: true }).setView([-15.77, -47.92], 5)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map)

      const bounds = []

      pontos.forEach((ponto, idx) => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#f97316;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);font-family:Inter,sans-serif">${idx + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })

        const marker = L.marker([ponto.lat, ponto.lng], { icon }).addTo(map)
        marker.bindPopup(`
          <div style="font-family:Inter,sans-serif;min-width:180px">
            <b style="font-size:13px">${idx + 1}. ${ponto.nome_ponto || ponto.endereco}</b><br/>
            <span style="font-size:11px;color:#666">${ponto.ambiente}</span><br/>
            <span style="font-size:11px;color:#f97316">${ponto.marcas?.join(', ') || ''}</span>
          </div>
        `)
        bounds.push([ponto.lat, ponto.lng])
      })

      // Linha da rota
      L.polyline(bounds, { color: '#f97316', weight: 2.5, opacity: 0.8, dashArray: '6,4' }).addTo(map)

      // Ajusta zoom
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [32, 32] })
      }

      // Força invalidação do tamanho após render
      setTimeout(() => { map.invalidateSize() }, 100)
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [pontos])

  return (
    <div style={{ position: 'relative', width: '100%', height: '480px', backgroundColor: '#111', borderRadius: '12px', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
