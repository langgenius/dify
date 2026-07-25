'use client'

import type { ReactNode } from 'react'
import type { DetailSidebarMode } from './preference'
import { useHydrateAtoms } from 'jotai/react/utils'
import { initializeDetailSidebarModeAtom } from './state'

export function DetailSidebarStateInitializer({
  children,
  initialMode,
}: {
  children: ReactNode
  initialMode: DetailSidebarMode
}) {
  useHydrateAtoms([[initializeDetailSidebarModeAtom, initialMode]])

  return children
}
