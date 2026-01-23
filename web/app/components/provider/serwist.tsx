'use client'

import { SerwistProvider } from '@serwist/turbopack/react'
import { useEffect } from 'react'
import { IS_DEV } from '@/config'

export function PWAProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (IS_DEV && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister()
        })
      }).catch((error) => {
        // Silently fail if service worker unregistration fails
        // This is a development-only optimization and shouldn't block the app
        console.warn('Failed to unregister service workers:', error)
      })
    }
  }, [])

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
