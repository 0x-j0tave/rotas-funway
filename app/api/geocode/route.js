import { NextResponse } from 'next/server'
import { geocodeEndereco } from '@/lib/geocode'

export async function POST(request) {
  const { endereco, cidade, uf } = await request.json()

  if (!endereco) {
    return NextResponse.json({ error: 'Endereço obrigatório' }, { status: 400 })
  }

  const result = await geocodeEndereco(endereco, cidade, uf)
  return NextResponse.json(result || { error: 'Não encontrado' })
}
