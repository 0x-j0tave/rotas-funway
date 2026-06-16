import './globals.css'

export const metadata = {
  title: 'OOH Rotas',
  description: 'Sistema de rotas para campanhas OOH',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  )
}
