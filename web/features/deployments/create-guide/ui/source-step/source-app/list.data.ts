'use client'

import type { App } from '@/types/app'
import { useAtomValue, useSetAtom } from 'jotai'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import {
  sourceAppsFromQueryData,
  useSourceAppsQuery,
} from '../../../queries/source'
import {
  selectedAppAtom,
  selectSourceAppAtom,
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

function useSourceApps() {
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const sourceAppsQuery = useSourceAppsQuery({ sourceSearchText })

  return sourceAppsFromQueryData(sourceAppsQuery.data)
}

export function useFilteredSourceApps() {
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const sourceApps = useSourceApps()

  return filterSourceAppsBySearchText(sourceApps, sourceSearchText)
}

export function useSourceAppsLoading() {
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const sourceAppsQuery = useSourceAppsQuery({ sourceSearchText })
  const sourceApps = sourceAppsFromQueryData(sourceAppsQuery.data)

  return sourceAppsQuery.isLoading || (sourceAppsQuery.isFetching && sourceApps.length === 0)
}

export function useSourceAppSelected(appId: string) {
  const selectedApp = useAtomValue(selectedAppAtom)
  const sourceApps = useSourceApps()
  const effectiveSelectedApp = isWorkflowApp(selectedApp) ? selectedApp : sourceApps[0]
  const effectiveSelectedAppId = effectiveSelectedApp?.id ?? sourceApps[0]?.id

  return effectiveSelectedAppId === appId
}

export function useSelectSourceAppAction() {
  return useSetAtom(selectSourceAppAtom)
}
