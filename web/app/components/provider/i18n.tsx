'use client'

import type { Resource } from 'i18next'
import type { Locale } from '@/i18n-config'
import { I18nextProvider } from 'react-i18next'
import { createI18nextInstance } from '@/i18n-config/client'

export function I18nClientProvider({
  locale,
  resource,
  children,
}: {
  locale: Locale
  resource: Resource
  children: React.ReactNode
}) {
  const i18n = createI18nextInstance(locale, resource)

  return (
    <I18nextProvider i18n={i18n}>
      {children}
    </I18nextProvider>
  )
}
