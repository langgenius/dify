'use client'

import { useHydrateAtoms } from 'jotai/utils'
import { preserveSearchStateInQueryAtom } from './atoms'

export function HydrateMarketplaceAtoms({
  preserveSearchStateInQuery,
  children,
}: {
  preserveSearchStateInQuery: boolean
  children: React.ReactNode
}) {
  useHydrateAtoms([[preserveSearchStateInQueryAtom, preserveSearchStateInQuery]])
  return <>{children}</>
}
