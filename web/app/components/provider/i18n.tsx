'use client'

import type { Resource } from 'i18next'
import type { Locale } from '@/i18n'
import resourcesToBackend from 'i18next-resources-to-backend'
import { I18nProvider } from 'next-i18next/client'
import { useState } from 'react'
import { loadI18nResource } from '@/i18n/load-resource'
import { defaultLocale, supportedLocales } from '@/i18n/locale'
import { getInitOptions } from '@/i18n/settings'

const backends = [resourcesToBackend(loadI18nResource)]

export function I18nClientProvider({
  locale,
  resource,
  children,
}: {
  locale: Locale
  resource: Resource
  children: React.ReactNode
}) {
  // Server resources bootstrap this session. Client preferences and share-app
  // overrides own later language changes, even when the root layout rerenders.
  const [initial] = useState(() => ({
    locale,
    resource,
    options: {
      ...getInitOptions(['common']),
      fallbackNS: false as const,
      react: { useSuspense: true },
    },
  }))
  return (
    <I18nProvider
      language={initial.locale}
      resources={initial.resource}
      supportedLngs={supportedLocales}
      defaultNS="common"
      fallbackLng={defaultLocale}
      use={backends}
      ssrBackend
      i18nextOptions={initial.options}
    >
      {children}
    </I18nProvider>
  )
}
