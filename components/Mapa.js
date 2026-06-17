'use client'
import { useEffect, useRef, useState } from 'react'

export default function Mapa({ pontos }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [aberto, setAberto] = useState(false)
  const [iniciado, setIniciado] = useState(false)

  useEffect(() => {
    setAberto(false)
    setIniciado(false)
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
  }, [pontos])

  useEffect(() => {
    if (!aberto || iniciado || !containerRef.current) return

    const el = containerRef.current

    const inicializar = () => {
      if (mapRef.current) return
      import('leaflet').then(L => {
        if (mapRef.current) return

        delete L.Icon.Default.prototype._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        })

        const map = L.map(el, { zoomControl: true })
        mapRef.current = map

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap', maxZoom: 19
        }).addTo(map)

        const bounds = []
        pontos.forEach((p, i) => {
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:#f97316;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${i + 1}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
          })
          L.marker([p.lat, p.lng], { icon }).addTo(map)
            .bindPopup(`<b>${i + 1}. ${p.nome_ponto || p.endereco}</b><br/><small>${p.ambiente}</small>`)
          bounds.push([p.lat, p.lng])
        })

        L.polyline(bounds, { color: '#f97316', weight: 3, opacity: 0.8, dashArray: '8,5' }).addTo(map)
        map.fitBounds(bounds, { padding: [40, 40] })
        setIniciado(true)
      })
    }

    // Usa ResizeObserver — só inicializa quando o container tem largura real
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          observer.disconnect()
          inicializar()
        }
      }
    })

    observer.observe(el)

    return () => observer.disconnect()
  }, [aberto, iniciado, pontos])

  if (!aberto) {
    return (
      <div style={{ width: '100%', height: '420px', backgroundColor: '#f7f7f7', border: '1px solid #e8e8e8', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        <span style={{ fontSize: '36px' }}>🗺️</span>
        <p style={{ fontSize: '14px', color: '#888', fontWeight: '500', margin: 0 }}>{pontos?.length} pontos na rota</p>
        <button onClick={() => setAberto(true)} style={{ padding: '10px 28px', background: 'linear-gradient(135deg, #f97316, #ea580c)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
          Visualizar mapa
        </button>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '420px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e8e8e8' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
