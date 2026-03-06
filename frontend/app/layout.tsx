import type { Metadata } from 'next'
import { IntlProvider } from '@/components/IntlProvider'
import { AuthProvider } from '@/context/AuthContext'
import { SWRProvider } from '@/components/SWRProvider'
import { DeepLinkListener } from '@/components/DeepLinkListener'
import './globals.css'

export const metadata: Metadata = {
  title: 'AXSHARE — Secure File Sharing',
  description: 'End-to-end encrypted file sharing',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it">
      <body>
        <IntlProvider>
          <AuthProvider>
            <SWRProvider>
              <DeepLinkListener />
              {children}
            </SWRProvider>
          </AuthProvider>
        </IntlProvider>
      </body>
    </html>
  )
}
