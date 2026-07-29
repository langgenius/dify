'use client'

import { atom } from 'jotai'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'

const systemFeaturesQueryAtom = atomWithResolvedSuspenseQuery(() => systemFeaturesQueryOptions())

const systemFeaturesAtom = atom((get) => {
  return get(systemFeaturesQueryAtom).data
})

export const deploymentEditionAtom = atom((get) => {
  return get(systemFeaturesAtom).deployment_edition
})

export const brandingEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).branding.enabled
})
