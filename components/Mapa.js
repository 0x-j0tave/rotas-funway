'use client'
import { useEffect, useRef } from 'react'

export default function Mapa({ pontos }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!mapRef.current) return

    import('leaflet').then(L => {
      // Fix ícones Leaflet
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      })

      // Destrói mapa anterior se existir
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      if (!pontos || pontos.length === 0) return

      const centro = [pontos[0].lat, pontos[0].lng]
      const map = L.map(mapRef.current).setView(centro, 13)
      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map)

      // Adiciona marcadores numerados
      pontos.forEach((ponto, idx) => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#2563eb;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${idx + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })

        L.marker([ponto.lat, ponto.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <b>${idx + 1}. ${ponto.nome_ponto || ponto.endereco}</b><br/>
            ${ponto.ambiente}<br/>
            <small>${ponto.marcas?.join(', ') || ''}</small>
          `)
      })

      // Desenha linha da rota
      const coordenadas = pontos.map(p => [p.lat, p.lng])
      L.polyline(coordenadas, { color: '#2563eb', weight: 3, opacity: 0.7 }).addTo(map)

      // Ajusta zoom para caber todos os pontos
      map.fitBounds(coordenadas)
    })

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [pontos])

  return (
    <div
      ref={mapRef}
      style={{ height: '500px', width: '100%', borderRadius: '8px' }}
    />
  )
}
