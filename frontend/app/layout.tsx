import type { Metadata } from 'next'
import { IntlProvider } from '@/components/IntlProvider'
import { AuthProvider } from '@/context/AuthContext'
import { SyncProvider } from '@/context/SyncContext'
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
            <SyncProvider>
              <SWRProvider>
                <DeepLinkListener />
                {children}
              </SWRProvider>
            </SyncProvider>
          </AuthProvider>
        </IntlProvider>
      </body>
    </html>
  )
}
