'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAIN_CONTENT_ID, SkipNav } from '@/app/components/main-nav/skip-nav'
import Header from '@/app/signin/_header'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export default function MigrateConversationsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common'])
  const [year] = useState(() => new Date().getFullYear())
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <div className="flex min-h-dvh w-full bg-background-default-burn p-1">
      <SkipNav>{t(($) => $['navigation.skipToMain'], { ns: 'common' })}</SkipNav>
      <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-effects-highlight bg-background-default-subtle">
        <Header compact className="flex-wrap gap-2 pt-4 pr-3 pb-3 pl-6" />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex min-h-0 flex-1 items-center justify-center px-6 py-8 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset lg:pt-0 lg:pb-30"
        >
          {children}
        </main>
        {!systemFeatures.branding.enabled && (
          <footer className="px-6 pt-2 pb-6 text-center system-xs-regular text-text-tertiary">
            {t(($) => $['workspace.create.copyright'], { ns: 'common', year })}
          </footer>
        )}
      </div>
    </div>
  )
}
