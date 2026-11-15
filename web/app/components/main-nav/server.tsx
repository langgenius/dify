import type { ReactNode } from 'react'
import {
  DETAIL_SIDEBAR_COOKIE_NAME,
  parseDetailSidebarMode,
} from '@/app/components/detail-sidebar/cookie'
import { cookies, headers } from '@/next/headers'
import MainNavLayoutClient from './layout'
import { getPlatformFromUserAgent } from './shortcut-platform'

export default async function MainNavLayout({
  children,
  detailSidebar,
}: {
  children: ReactNode
  detailSidebar?: ReactNode
}) {
  const [requestHeaders, requestCookies] = await Promise.all([headers(), cookies()])
  const initialPlatform = getPlatformFromUserAgent(requestHeaders.get('user-agent'))
  const initialDetailSidebarMode = parseDetailSidebarMode(
    requestCookies.get(DETAIL_SIDEBAR_COOKIE_NAME)?.value,
  )

  return (
    <MainNavLayoutClient
      detailSidebar={detailSidebar}
      initialPlatform={initialPlatform}
      initialDetailSidebarMode={initialDetailSidebarMode}
    >
      {children}
    </MainNavLayoutClient>
  )
}
