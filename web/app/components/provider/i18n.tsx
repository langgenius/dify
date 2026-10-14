'use client'

import type { Resource } from 'i18next'
import type { Locale } from '@/i18n'
import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { useId, useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { loadI18nResource } from '@/i18n/load-resource'
import { supportedLocales } from '@/i18n/locale'
import { getInitOptions } from '@/i18n/settings'
import { getStreamedResources, mergeResources } from '@/i18n/streamed-resources'
import { I18nResourceStream } from './i18n-stream'

export function I18nClientProvider({
  locale,
  resource,
  children,
  nonce,
}: {
  nonce?: string
  locale: Locale
  resource: Resource
  children: React.ReactNode
}) {
  const streamId = useId()
  // Server resources bootstrap this session. Client preferences and share-app
  // overrides own later language changes, even when the root layout rerenders.
  const [initial] = useState(() => {
    const resources = mergeResources(resource, getStreamedResources(streamId))
    const i18n = createInstance()
    void i18n
      .use(initReactI18next)
      .use(resourcesToBackend(loadI18nResource))
      .init({
        ...getInitOptions([]),
        // Register streamed namespaces so language changes load their translations.
        ns: [...new Set(Object.values(resources).flatMap(Object.keys))],
        lng: locale,
        resources,
        supportedLngs: supportedLocales,
        fallbackNS: false,
        react: { useSuspense: true },
      })
    return { i18n, resources }
  })
  return (
    <I18nextProvider i18n={initial.i18n}>
      <I18nResourceStream id={streamId} initial={initial.resources} nonce={nonce} />
      {children}
    </I18nextProvider>
  )
}
