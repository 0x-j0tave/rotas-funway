import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('excels_salvos')
    .select('*')
    .gt('expira_em', new Date().toISOString())
    .order('criado_em', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request) {
  const { nome_marca, nome_arquivo, storage_path, total_pontos, cidades } = await request.json()

  const { data, error } = await supabase
    .from('excels_salvos')
    .insert([{ nome_marca, nome_arquivo, storage_path, total_pontos, cidades }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request) {
  const { id, storage_path } = await request.json()
  await supabase.storage.from('excels').remove([storage_path])
  const { error } = await supabase.from('excels_salvos').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
