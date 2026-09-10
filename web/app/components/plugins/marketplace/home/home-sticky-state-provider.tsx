'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { homeCatalogPinnedAtom, homeStickyScopedAtoms } from './home-sticky-state'
import styles from './home-sticky.module.css'

export function HomeStickyStateProvider({ children }: { children: ReactNode }) {
  return (
    <ScopeProvider atoms={homeStickyScopedAtoms} name="MarketplaceHomeSticky">
      {children}
    </ScopeProvider>
  )
}

export function HomeStickyCatalogTabs({ children }: { children: ReactNode }) {
  const isCatalogPinned = useAtomValue(homeCatalogPinnedAtom)

  return (
    <div
      aria-hidden={!isCatalogPinned ? true : undefined}
      className={cn(styles.headerCatalogSlot, isCatalogPinned && styles.headerCatalogSlotPinned)}
      data-home-catalog-tabs-slot="header"
      inert={!isCatalogPinned ? true : undefined}
    >
      {children}
    </div>
  )
}
