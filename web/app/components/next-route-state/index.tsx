'use client'

import type { ReactNode } from 'react'
import type { NextRouteParams } from './atoms'
import { useHydrateAtoms } from 'jotai/utils'
import { useParams, usePathname } from '@/next/navigation'
import {
  setNextRouteStateAtom,
} from './atoms'

export function NextRouteStateBridge({ children }: {
  children: ReactNode
}) {
  const pathname = usePathname()
  const params = useParams<NextRouteParams>()

  useHydrateAtoms([
    [setNextRouteStateAtom, {
      pathname,
      params,
    }],
  ] as const, { dangerouslyForceHydrate: true })

  return children
}
