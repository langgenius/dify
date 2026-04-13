import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { BlockEnum } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

type OverviewCardType = 'api' | 'webapp'

export type OverviewOperationKey = 'launch' | 'embedded' | 'customize' | 'settings' | 'develop'

type AppInfo = AppDetailResponse & Partial<AppSSO>

type WorkflowLike = {
  graph?: {
    nodes?: Array<{
      data?: {
        type?: string
      }
    }>
  }
} | null | undefined

type AccessSubjectsLike = {
  groups?: unknown[]
  members?: unknown[]
} | null | undefined

type AppCardDisplayState = {
  isApp: boolean
  appMode: AppModeEnum
  appUnpublished: boolean
  missingStartNode: boolean
  hasInsufficientPermissions: boolean
  toggleDisabled: boolean
  runningStatus: boolean
  isMinimalState: boolean
  accessibleUrl: string
}

const getCardAppMode = (mode: AppModeEnum) => {
  return (mode !== AppModeEnum.COMPLETION && mode !== AppModeEnum.WORKFLOW) ? AppModeEnum.CHAT : mode
}

export const hasWorkflowStartNode = (currentWorkflow: WorkflowLike) => {
  return currentWorkflow?.graph?.nodes?.some(node => node.data?.type === BlockEnum.Start) ?? false
}

export const getAppCardDisplayState = ({
  appInfo,
  cardType,
  currentWorkflow,
  isCurrentWorkspaceEditor,
  isCurrentWorkspaceManager,
  triggerModeDisabled = false,
}: {
  appInfo: AppInfo
  cardType: OverviewCardType
  currentWorkflow: WorkflowLike
  isCurrentWorkspaceEditor: boolean
  isCurrentWorkspaceManager: boolean
  triggerModeDisabled?: boolean
}): AppCardDisplayState => {
  const isApp = cardType === 'webapp'
  const isWorkflowApp = appInfo.mode === AppModeEnum.WORKFLOW
  const appUnpublished = isWorkflowApp && !currentWorkflow?.graph
  const missingStartNode = isWorkflowApp && !hasWorkflowStartNode(currentWorkflow)
  const hasInsufficientPermissions = isApp ? !isCurrentWorkspaceEditor : !isCurrentWorkspaceManager
  const toggleDisabled = hasInsufficientPermissions || appUnpublished || missingStartNode || triggerModeDisabled
  const runningStatus = (appUnpublished || missingStartNode) ? false : (isApp ? appInfo.enable_site : appInfo.enable_api)
  const appMode = getCardAppMode(appInfo.mode)
  const appBaseUrl = appInfo.site?.app_base_url ?? ''
  const accessToken = appInfo.site?.access_token ?? ''

  return {
    isApp,
    appMode,
    appUnpublished,
    missingStartNode,
    hasInsufficientPermissions,
    toggleDisabled,
    runningStatus,
    isMinimalState: appUnpublished || missingStartNode,
    accessibleUrl: isApp ? `${appBaseUrl}${basePath}/${appMode}/${accessToken}` : (appInfo.api_base_url ?? ''),
  }
}

export const isAppAccessConfigured = (appDetail: AppDetailResponse | null | undefined, appAccessSubjects: AccessSubjectsLike) => {
  if (!appDetail || !appAccessSubjects)
    return true

  if (appDetail.access_mode !== AccessMode.SPECIFIC_GROUPS_MEMBERS)
    return true

  return Boolean(appAccessSubjects.groups?.length || appAccessSubjects.members?.length)
}

export const getAppCardOperationKeys = ({
  cardType,
  appMode,
  isCurrentWorkspaceEditor,
}: {
  cardType: OverviewCardType
  appMode: AppModeEnum
  isCurrentWorkspaceEditor: boolean
}): OverviewOperationKey[] => {
  if (cardType === 'api')
    return ['develop']

  const operationKeys: OverviewOperationKey[] = ['launch']
  if (appMode !== AppModeEnum.COMPLETION && appMode !== AppModeEnum.WORKFLOW)
    operationKeys.push('embedded')

  operationKeys.push('customize')
  if (isCurrentWorkspaceEditor)
    operationKeys.push('settings')

  return operationKeys
}
