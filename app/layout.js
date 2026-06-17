import './globals.css'

export const metadata = {
  title: 'Rotas Funway',
  description: 'Sistema de rotas para campanhas OOH',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
