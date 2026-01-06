'use client'

import type { i18n, Resource } from 'i18next'
import type { Locale } from '@/i18n-config'
import { I18nextProvider } from 'react-i18next'
import { createI18nextInstance } from '@/i18n-config/i18next-config'

export type II18nProps = {
  locale: Locale
  resource: Resource
  children: React.ReactNode
}

let i18nextInstance: i18n | null = null

export function I18n({
  locale,
  resource,
  children,
}: II18nProps) {
  if (!i18nextInstance || i18nextInstance.language !== locale) {
    i18nextInstance = createI18nextInstance(locale, resource)
  }
  return (
    <I18nextProvider i18n={i18nextInstance}>
      {children}
    </I18nextProvider>
  )
}
