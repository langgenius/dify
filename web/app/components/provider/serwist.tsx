'use client'

import { SerwistProvider } from '@serwist/turbopack/react'
import { useEffect } from 'react'
import { IS_DEV } from '@/config'
import { isClient } from '@/utils/client'

export function PWAProvider({ children }: { children: React.ReactNode }) {
  if (IS_DEV) {
    return <DisabledPWAProvider>{children}</DisabledPWAProvider>
  }

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const swUrl = `${basePath}/serwist/sw.js`

  return (
    <SerwistProvider swUrl={swUrl}>
      {children}
    </SerwistProvider>
  )
}

function DisabledPWAProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (isClient && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => {
          registrations.forEach((registration) => {
            registration.unregister()
              .catch((error) => {
                console.error('Error unregistering service worker:', error)
              })
          })
        })
        .catch((error) => {
          console.error('Error unregistering service workers:', error)
        })
    }
  }, [])

  return <>{children}</>
}
