'use client'
import { useEffect, useRef } from 'react'

export default function Mapa({ pontos }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!pontos || pontos.length === 0) return

    const init = () => {
      import('leaflet').then(L => {
        delete L.Icon.Default.prototype._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        })

        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }

        if (!containerRef.current) return

        const map = L.map(containerRef.current, { zoomControl: true })
        mapRef.current = map

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(map)

        const bounds = []

        pontos.forEach((ponto, idx) => {
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:#f97316;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);font-family:sans-serif">${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })

          L.marker([ponto.lat, ponto.lng], { icon })
            .addTo(map)
            .bindPopup(`<b>${idx + 1}. ${ponto.nome_ponto || ponto.endereco}</b><br/><small>${ponto.ambiente}</small><br/><small style="color:#f97316">${ponto.marcas?.join(', ') || ''}</small>`)

          bounds.push([ponto.lat, ponto.lng])
        })

        L.polyline(bounds, { color: '#f97316', weight: 2.5, opacity: 0.8, dashArray: '6,4' }).addTo(map)
        map.fitBounds(bounds, { padding: [40, 40] })

        // Múltiplos invalidateSize para garantir
        ;[100, 300, 600, 1000].forEach(ms => {
          setTimeout(() => { map.invalidateSize() }, ms)
        })
      })
    }

    // Aguarda container estar no DOM com dimensões reais
    const timer = setTimeout(init, 50)

    return () => {
      clearTimeout(timer)
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [pontos])

  return (
    <div style={{ width: '100%', height: '480px', position: 'relative', backgroundColor: '#111', borderRadius: '12px', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0 }}
      />
    </div>
  )
}
