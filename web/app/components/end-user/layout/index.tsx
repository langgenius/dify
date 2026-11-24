'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MAIN_CONTENT_ID, SkipLink } from '@/app/components/main-nav/skip-link'
import { usePathname, useSearchParams } from '@/next/navigation'
import { WEBAPP_PORTAL_LOGIN_CODE } from '@/service/webapp-address'
import PortalLoginHandoff from './portal-login-handoff'
import Sidebar from './sidebar'

export default function EndUserLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common'])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const loginCode = searchParams.get(WEBAPP_PORTAL_LOGIN_CODE)

  if (pathname.replace(/\/$/, '') === '/my-apps' && loginCode !== null)
    return <PortalLoginHandoff key={loginCode} />

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background-body md:flex-row">
      <SkipLink>{t(($) => $['navigation.skipToMain'], { ns: 'common' })}</SkipLink>
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
