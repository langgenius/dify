'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAIN_CONTENT_ID, SkipNav } from '@/app/components/main-nav/skip-nav'
import Header from '@/app/signin/_header'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export default function CreateWorkspaceLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common'])
  const [year] = useState(() => new Date().getFullYear())
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <div className="flex min-h-dvh w-full bg-background-default-burn p-6">
      <SkipNav>{t(($) => $['navigation.skipToMain'], { ns: 'common' })}</SkipNav>
      <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <Header className="flex-wrap gap-4" />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
        >
          <div className="w-full max-w-105">{children}</div>
        </main>
        {!systemFeatures.branding.enabled && (
          <footer className="px-6 pt-2 pb-6 text-center system-xs-regular text-text-tertiary">
            {t(($) => $['workspace.create.copyright'], {
              ns: 'common',
              year,
            })}
          </footer>
        )}
      </div>
    </div>
  )
}
