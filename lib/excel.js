import * as XLSX from 'xlsx'

// Normaliza string: remove acentos, trim, title case para cidades
function normalizar(str) {
  if (!str) return ''
  return str.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Normaliza apenas para comparação (lowercase sem acentos)
function normalizarChave(str) {
  if (!str) return ''
  return str.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export { normalizarChave }

export function parsearExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  // Encontra a linha do header (procura por AMBIENTE)
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.some(cell => String(cell).toUpperCase().trim() === 'AMBIENTE')) {
      headerIdx = i
      break
    }
  }

  if (headerIdx === -1) throw new Error('Header não encontrado. Certifique que o Excel tem a coluna AMBIENTE.')

  const headers = rows[headerIdx].map(h => String(h).toUpperCase().trim())
  const idxAmbiente = headers.indexOf('AMBIENTE')
  const idxCod = headers.findIndex(h => h.includes('CÓD') || h.includes('COD'))
  const idxPonto = headers.indexOf('PONTO')
  const idxEndereco = headers.findIndex(h => h.includes('ENDEREÇO') || h.includes('ENDERECO'))
  const idxUf = headers.indexOf('UF')
  const idxCidade = headers.indexOf('CIDADE')
  const idxPraca = headers.findIndex(h => h.includes('PRAÇA') || h.includes('PRACA'))

  const pontos = []

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const ambiente = String(row[idxAmbiente] || '').trim()
    const cod = String(row[idxCod] || '').trim()
    const endereco = String(row[idxEndereco] || '').trim()
    const cidade = String(row[idxCidade] || '').trim()
    const uf = String(row[idxUf] || '').trim()

    // Pula linhas vazias
    if (!ambiente || !cod || !endereco) continue

    pontos.push({
      ambiente: ambiente.trim(),
      cod_ponto: cod,
      nome_ponto: String(row[idxPonto] || '').trim(),
      endereco: endereco.trim(),
      uf: uf.trim().toUpperCase(),
      cidade: normalizar(cidade),
      praca: idxPraca >= 0 ? String(row[idxPraca] || '').trim() : ''
    })
  }

  return pontos
}

export function extrairCidades(pontos) {
  const cidades = [...new Set(pontos.map(p => p.cidade).filter(Boolean))]
  return cidades.sort()
}

export function extrairAmbientes(pontos, cidade) {
  const filtrados = cidade ? pontos.filter(p => p.cidade === cidade) : pontos
  const ambientes = [...new Set(filtrados.map(p => p.ambiente).filter(Boolean))]
  return ambientes.sort()
}
