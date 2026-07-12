'use client'

import { atom } from 'jotai'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'

const systemFeaturesQueryAtom = atomWithResolvedSuspenseQuery(() => systemFeaturesQueryOptions())

export const systemFeaturesAtom = atom((get) => {
  return get(systemFeaturesQueryAtom).data
})

export const datasetRbacEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).rbac_enabled
})
