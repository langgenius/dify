'use client'

import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import dynamic from 'next/dynamic'
import { Suspense, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { initReactI18next } from 'react-i18next/initReactI18next'
import { loadI18nResource } from '@/i18n/load-resource'
import { getInitOptions } from '@/i18n/settings'

const PresentationDeck = dynamic(() => import('./deck'), {
  ssr: false,
  loading: PresentationLoading,
})

export function GenerativeUIPresentation() {
  const [i18n] = useState(() => {
    const instance = createInstance()
    void instance
      .use(initReactI18next)
      .use(resourcesToBackend(loadI18nResource))
      .init({ ...getInitOptions(['presentation']), lng: 'zh-Hans' })
    return instance
  })

  return (
    <I18nextProvider i18n={i18n}>
      <main className="h-dvh bg-background-body" lang="zh-Hans" dir="ltr">
        <Suspense fallback={<PresentationLoading />}>
          <PresentationDeck />
        </Suspense>
      </main>
    </I18nextProvider>
  )
}

function PresentationLoading() {
  return (
    <div role="status" className="flex h-full items-center justify-center text-text-tertiary">
      Dify Generative UI
    </div>
  )
}
