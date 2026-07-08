'use client'

import { useAtomValue } from 'jotai'
import { appContextExternalSyncAtom } from './app-context-external-sync'

export function AppContextBootstrapQueries() {
  useAtomValue(appContextExternalSyncAtom)

  return null
}
