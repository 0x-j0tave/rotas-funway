import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request) {
  const { nome, cidade, parametros, pontos } = await request.json()

  const { data, error } = await supabase
    .from('rotas_salvas')
    .insert([{ nome, cidade, parametros, pontos_json: pontos }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function GET() {
  const { data, error } = await supabase
    .from('rotas_salvas')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
