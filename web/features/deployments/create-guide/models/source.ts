import type { GuideMethod } from '../types'
import type { CreateGuideDslState } from './dsl'
import type { App } from '@/types/app'
import { isWorkflowApp } from '@/features/deployments/app-mode'

export function createEffectiveSelectedApp(selectedApp: App | undefined, sourceApps: App[]) {
  return isWorkflowApp(selectedApp) ? selectedApp : sourceApps[0]
}

export function createSelectedWorkflowSourceApp(selectedApp: App | undefined) {
  return isWorkflowApp(selectedApp) ? selectedApp : undefined
}

export function createSourceStatus({
  dslFallbackAppName,
  dslReadError,
  dslState,
  effectiveSelectedApp,
  isReadingDsl,
  method,
}: {
  dslFallbackAppName: string
  dslReadError: boolean
  dslState: CreateGuideDslState
  effectiveSelectedApp?: App
  isReadingDsl: boolean
  method: GuideMethod
}) {
  const sourceName = method === 'importDsl'
    ? dslState.dslDefaultAppName || dslFallbackAppName
    : effectiveSelectedApp?.name
  const isSourceReady = method === 'importDsl'
    ? dslState.hasDslContent && !isReadingDsl && !dslReadError && !dslState.dslUnsupportedMode
    : Boolean(effectiveSelectedApp?.id)

  return {
    effectiveSelectedApp,
    isSourceReady,
    sourceName,
  }
}

function createSourceAppSearchText(app: App) {
  return `${app.name} ${app.id}`.toLowerCase()
}

export function filterSourceAppsBySearchText(sourceApps: App[], sourceSearchText: string) {
  const searchText = sourceSearchText.trim().toLowerCase()

  if (!searchText)
    return sourceApps

  return sourceApps.filter(app => createSourceAppSearchText(app).includes(searchText))
}
