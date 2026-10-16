'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MAIN_CONTENT_ID, SkipNav } from '@/app/components/main-nav/skip-nav'
import Sidebar from './sidebar'

export default function EndUserLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common'])

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background-body md:flex-row">
      <SkipNav>{t(($) => $['navigation.skipToMain'], { ns: 'common' })}</SkipNav>
      <Sidebar />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
      >
        {children}
      </main>
    </div>
  )
}
