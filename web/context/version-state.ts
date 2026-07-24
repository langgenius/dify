'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { accountProfileMetaAtom } from './account-state'
import { initialLangGeniusVersionInfo } from './app-context-defaults'
import { getLangGeniusVersionInfo } from './app-context-normalizers'
import { brandingEnabledAtom } from './system-features-state'

const versionQueryAtom = atomWithQuery((get) => {
  const meta = get(accountProfileMetaAtom)
  const brandingEnabled = get(brandingEnabledAtom)
  const enabled = Boolean(meta.currentVersion && !brandingEnabled)

  return consoleQuery.version.get.queryOptions({
    input: {
      query: {
        current_version: meta.currentVersion ?? '',
      },
    },
    enabled,
  })
})

export const langGeniusVersionInfoAtom = atom((get) => {
  const meta = get(accountProfileMetaAtom)
  const versionData = get(versionQueryAtom).data

  if (!versionData) return initialLangGeniusVersionInfo

  return getLangGeniusVersionInfo({
    meta,
    versionData,
  })
})

export const langGeniusCurrentVersionAtom = atom((get) => {
  return get(langGeniusVersionInfoAtom).current_version
})
