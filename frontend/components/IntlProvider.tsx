'use client'

import { NextIntlClientProvider } from 'next-intl'
import itMessages from '@/messages/it.json'

const defaultLocale = 'it'

export function IntlProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={defaultLocale} messages={itMessages}>
      {children}
    </NextIntlClientProvider>
  )
}
