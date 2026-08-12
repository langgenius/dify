'use client'

import { atom } from 'jotai'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'
import { systemFeaturesQueryOptions } from './client'

const systemFeaturesQueryAtom = atomWithResolvedSuspenseQuery(() => systemFeaturesQueryOptions())

const systemFeaturesAtom = atom((get) => {
  return get(systemFeaturesQueryAtom).data
})

export const deploymentEditionAtom = atom((get) => {
  return get(systemFeaturesAtom).deployment_edition
})

export const knowledgeFsUploadEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).knowledge_fs_upload_enabled
})

export const knowledgeFsEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).knowledge_fs_enabled
})

export const rbacEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).rbac_enabled
})
