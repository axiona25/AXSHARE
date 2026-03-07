import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { IntlProvider } from '@/components/IntlProvider'
import { AuthProvider } from '@/context/AuthContext'
import { SyncProvider } from '@/context/SyncContext'
import { SWRProvider } from '@/components/SWRProvider'
import { DeepLinkListener } from '@/components/DeepLinkListener'
import './globals.css'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AXSHARE — Secure File Sharing',
  description: 'End-to-end encrypted file sharing',
  icons: { icon: '/favicon.png' },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it" className={plusJakarta.variable}>
      <body className={plusJakarta.className}>
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
