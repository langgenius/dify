'use client'

import type { App } from '@/types/app'
import { useAtomValue } from 'jotai'
import {
  sourceAppsFromQueryData,
  useSourceAppsQuery,
} from '../../../queries/source'
import {
  selectedAppAtom,
  sourceSearchTextAtom,
} from '../../../state/source-atoms'

function sourceAppSearchText(app: App) {
  return `${app.name} ${app.id}`.toLowerCase()
}

function filterSourceAppsBySearchText(sourceApps: App[], sourceSearchText: string) {
  const searchText = sourceSearchText.trim().toLowerCase()

  if (!searchText)
    return sourceApps

  return sourceApps.filter(app => sourceAppSearchText(app).includes(searchText))
}

export function useSourceAppListQuery() {
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)

  return useSourceAppsQuery({ sourceSearchText })
}

export function useSourceApps() {
  return sourceAppsFromQueryData(useSourceAppListQuery().data)
}

export function useFilteredSourceApps() {
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const sourceApps = useSourceApps()

  return filterSourceAppsBySearchText(sourceApps, sourceSearchText)
}

export function useSourceAppSelected(appId: string) {
  const selectedApp = useAtomValue(selectedAppAtom)
  const sourceApps = useSourceApps()
  const effectiveSelectedApp = selectedApp ?? sourceApps[0]

  return effectiveSelectedApp?.id === appId
}
