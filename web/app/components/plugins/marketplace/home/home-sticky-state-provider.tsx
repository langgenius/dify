'use client'

import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { homeCatalogPinnedAtom, homeStickyScopedAtoms } from './home-sticky-state'

export function HomeStickyStateProvider({ children }: { children: ReactNode }) {
  return (
    <ScopeProvider atoms={homeStickyScopedAtoms} name="MarketplaceHomeSticky">
      {children}
    </ScopeProvider>
  )
}

export function HomeStickyCatalogTabs({ children }: { children: ReactNode }) {
  const isCatalogPinned = useAtomValue(homeCatalogPinnedAtom)

  return isCatalogPinned ? children : null
}
