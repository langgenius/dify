'use client'

import { SerwistProvider } from '@serwist/turbopack/react'
import { IS_DEV } from '@/config'

export function PWAProvider({ children }: { children: React.ReactNode }) {
  if (IS_DEV) {
    return <>{children}</>
  }

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const swUrl = `${basePath}/serwist/sw.js`

  return (
    <SerwistProvider swUrl={swUrl}>
      {children}
    </SerwistProvider>
  )
}
