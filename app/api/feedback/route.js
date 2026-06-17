import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Salva feedback de outlier
export async function POST(request) {
  const { cidade, ambiente, cod_ponto, distancia_km } = await request.json()

  const { data, error } = await supabase
    .from('feedback_outliers')
    .insert([{ cidade, ambiente, cod_ponto, distancia_km }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Busca raios aprendidos para uma cidade
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const cidade = searchParams.get('cidade')

  let query = supabase.from('raio_aprendido').select('*')
  if (cidade) query = query.eq('cidade', cidade)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}
