'use client'

import { useHydrateAtoms } from 'jotai/utils'
import { preserveSearchStateInQueryAtom } from './atoms'

export function HydrateMarketplaceAtoms({ enable, children }: { enable: boolean, children: React.ReactNode }) {
  useHydrateAtoms([[preserveSearchStateInQueryAtom, enable]])
  return <>{children}</>
}
