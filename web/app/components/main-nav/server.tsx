import type { ReactNode } from 'react'
import { headers } from '@/next/headers'
import MainNavLayoutClient from './layout'
import { getPlatformFromUserAgent } from './shortcut-platform'

export default async function MainNavLayout({
  children,
  detailSidebar,
}: {
  children: ReactNode
  detailSidebar?: ReactNode
}) {
  const initialPlatform = getPlatformFromUserAgent((await headers()).get('user-agent'))

  return (
    <MainNavLayoutClient detailSidebar={detailSidebar} initialPlatform={initialPlatform}>
      {children}
    </MainNavLayoutClient>
  )
}
