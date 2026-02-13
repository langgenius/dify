'use client'

import { useHydrateAtoms } from 'jotai/utils'
import { isMarketplacePlatformAtom } from './atoms'

export function HydrateClient({
  isMarketplacePlatform = false,
  children,
}: {
  isMarketplacePlatform?: boolean
  children: React.ReactNode
}) {
  useHydrateAtoms([
    [isMarketplacePlatformAtom, isMarketplacePlatform],
  ])
  return <>{children}</>
}
