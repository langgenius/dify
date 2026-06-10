import type { GuideMethod } from '../types'
import type { UnsupportedDslNode } from '@/features/deployments/error'
import type { App } from '@/types/app'
import { isWorkflowDsl } from '@/features/deployments/dsl'

export function isCreateGuideDslUnsupportedMode({
  dslContent,
  dslReadError,
  hasDslContent,
  isReadingDsl,
  method,
}: {
  dslContent: string
  dslReadError: boolean
  hasDslContent: boolean
  isReadingDsl: boolean
  method: GuideMethod
}) {
  return method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !isWorkflowDsl(dslContent)
}

export function createGuideUnsupportedDslNodes({
  deploymentOptionsError,
  deploymentOptionsUnsupportedDslNodes,
  submissionUnsupportedDslNodes,
}: {
  deploymentOptionsError: boolean
  deploymentOptionsUnsupportedDslNodes: UnsupportedDslNode[]
  submissionUnsupportedDslNodes: UnsupportedDslNode[]
}) {
  if (submissionUnsupportedDslNodes.length > 0)
    return submissionUnsupportedDslNodes

  return deploymentOptionsError ? deploymentOptionsUnsupportedDslNodes : []
}

export function createGuideSourceName({
  dslDefaultAppName,
  dslFallbackAppName,
  method,
  selectedApp,
}: {
  dslDefaultAppName: string
  dslFallbackAppName: string
  method: GuideMethod
  selectedApp?: App
}) {
  if (method === 'importDsl')
    return dslDefaultAppName || dslFallbackAppName
  if (method === 'bindApp')
    return selectedApp?.name

  return undefined
}

export function isCreateGuideSourceReady({
  dslReadError,
  dslUnsupportedMode,
  hasDslContent,
  isReadingDsl,
  method,
  selectedApp,
}: {
  dslReadError: boolean
  dslUnsupportedMode: boolean
  hasDslContent: boolean
  isReadingDsl: boolean
  method: GuideMethod
  selectedApp?: App
}) {
  if (method === 'importDsl')
    return hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
  if (method === 'bindApp')
    return Boolean(selectedApp?.id)

  return false
}

export function isCreateGuideInitialReleaseReady({
  hasInstanceNameConflict,
  isSourceReady,
  submittedInstanceName,
  submittedReleaseName,
}: {
  hasInstanceNameConflict: boolean
  isSourceReady: boolean
  submittedInstanceName: string
  submittedReleaseName: string
}) {
  return Boolean(isSourceReady && submittedInstanceName && submittedReleaseName && !hasInstanceNameConflict)
}
