'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'

const systemFeaturesQueryAtom = atomWithResolvedSuspenseQuery(() => systemFeaturesQueryOptions())

const systemFeaturesPendingQueryAtom = atomWithQuery(() => systemFeaturesQueryOptions())

/** Render-path only — throws while pending; effects use `systemFeaturesOrNullAtom`. */
export const systemFeaturesAtom = atom((get) => {
  return get(systemFeaturesQueryAtom).data
})

export const systemFeaturesOrNullAtom = atom((get) => {
  return get(systemFeaturesPendingQueryAtom).data ?? null
})

export const datasetRbacEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).rbac_enabled
})
