'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'

const systemFeaturesQueryAtom = atomWithResolvedSuspenseQuery(() => systemFeaturesQueryOptions())

const systemFeaturesPendingQueryAtom = atomWithQuery(() => systemFeaturesQueryOptions())

/**
 * Render-path only — throws while the system-features query is pending.
 * atomEffect / non-render readers must use `systemFeaturesOrNullAtom` instead.
 */
export const systemFeaturesAtom = atom((get) => {
  return get(systemFeaturesQueryAtom).data
})

/** Pending-safe: `null` until the system-features query resolves. For atomEffect / non-render readers. */
export const systemFeaturesOrNullAtom = atom((get) => {
  return get(systemFeaturesPendingQueryAtom).data ?? null
})

export const datasetRbacEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).rbac_enabled
})
