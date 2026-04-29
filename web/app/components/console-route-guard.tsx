'use client'

import type { ReactNode } from 'react'
import { AppInitializer } from './app-initializer'

type ConsoleRouteGuardProps = {
  children: ReactNode
}

export const ConsoleRouteGuard = ({ children }: ConsoleRouteGuardProps) => {
  return (
    <AppInitializer>
      {children}
    </AppInitializer>
  )
}
