'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { accountProfileMetaAtom, accountProfileMetaOrNullAtom } from './account-state'
import { initialLangGeniusVersionInfo } from './app-context-defaults'
import { getLangGeniusVersionInfo } from './app-context-normalizers'
import { systemFeaturesOrNullAtom } from './system-features-state'

const versionQueryAtom = atomWithQuery((get) => {
  const meta = get(accountProfileMetaOrNullAtom)
  const systemFeatures = get(systemFeaturesOrNullAtom)
  const enabled = Boolean(
    meta?.currentVersion && systemFeatures && !systemFeatures.branding.enabled,
  )

  return consoleQuery.version.get.queryOptions({
    input: {
      query: {
        current_version: meta?.currentVersion ?? '',
      },
    },
    enabled,
  })
})

/**
 * Render-path only — reads the resolved-suspense profile meta and throws while
 * it is pending. atomEffect / non-render readers must use
 * `langGeniusVersionInfoOrDefaultAtom` instead.
 */
export const langGeniusVersionInfoAtom = atom((get) => {
  const meta = get(accountProfileMetaAtom)
  const versionData = get(versionQueryAtom).data

  if (!versionData) return initialLangGeniusVersionInfo

  return getLangGeniusVersionInfo({
    meta,
    versionData,
  })
})

/** Pending-safe: `initialLangGeniusVersionInfo` until profile meta and version data resolve. For atomEffect / non-render readers. */
export const langGeniusVersionInfoOrDefaultAtom = atom((get) => {
  const meta = get(accountProfileMetaOrNullAtom)
  const versionData = get(versionQueryAtom).data

  if (!meta || !versionData) return initialLangGeniusVersionInfo

  return getLangGeniusVersionInfo({
    meta,
    versionData,
  })
})

export const langGeniusCurrentVersionAtom = atom((get) => {
  return get(langGeniusVersionInfoAtom).current_version
})
