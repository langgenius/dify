import type { InputVar } from '@/app/components/workflow/types'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

type OverviewCardType = 'api' | 'webapp'

export type OverviewOperationKey = 'launch' | 'embedded' | 'customize' | 'settings' | 'develop'
export type WorkflowLaunchInputValue = string | boolean
export type WorkflowHiddenStartVariable = Pick<
  InputVar,
  'default' | 'hide' | 'label' | 'max_length' | 'options' | 'required' | 'type' | 'variable'
>

type AppInfo = AppDetailResponse & Partial<AppSSO>

type WorkflowLike = {
  graph?: {
    nodes?: Array<{
      data?: {
        type?: string
        variables?: InputVar[]
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

const SUPPORTED_WORKFLOW_LAUNCH_INPUT_TYPES = new Set<InputVarType>([
  InputVarType.textInput,
  InputVarType.paragraph,
  InputVarType.select,
  InputVarType.number,
  InputVarType.checkbox,
  InputVarType.json,
  InputVarType.jsonObject,
  InputVarType.url,
])

const coerceWorkflowLaunchDefaultValue = (variable: WorkflowHiddenStartVariable): WorkflowLaunchInputValue => {
  if (variable.type === InputVarType.checkbox) {
    if (typeof variable.default === 'boolean')
      return variable.default

    return String(variable.default).toLowerCase() === 'true'
  }

  if (typeof variable.default === 'number')
    return String(variable.default)

  return String(variable.default ?? '')
}

export const hasWorkflowStartNode = (currentWorkflow: WorkflowLike) => {
  return currentWorkflow?.graph?.nodes?.some(node => node.data?.type === BlockEnum.Start) ?? false
}

export const getWorkflowHiddenStartVariables = (currentWorkflow: WorkflowLike): WorkflowHiddenStartVariable[] => {
  const startNode = currentWorkflow?.graph?.nodes?.find(node => node.data?.type === BlockEnum.Start)
  return (startNode?.data?.variables ?? []).filter(variable => variable.hide === true)
}

export const getAppHiddenLaunchVariables = ({
  appInfo,
  currentWorkflow,
}: {
  appInfo: AppInfo
  currentWorkflow: WorkflowLike
}) => {
  if ([AppModeEnum.WORKFLOW, AppModeEnum.ADVANCED_CHAT].includes(appInfo.mode))
    return getWorkflowHiddenStartVariables(currentWorkflow)
}

export const isWorkflowLaunchInputSupported = (variable: WorkflowHiddenStartVariable) => {
  return SUPPORTED_WORKFLOW_LAUNCH_INPUT_TYPES.has(variable.type)
}

export const createWorkflowLaunchInitialValues = (variables: WorkflowHiddenStartVariable[]) => {
  return variables.reduce<Record<string, WorkflowLaunchInputValue>>((acc, variable) => {
    acc[variable.variable] = coerceWorkflowLaunchDefaultValue(variable)
    return acc
  }, {})
}

export const buildWorkflowLaunchUrl = async ({
  accessibleUrl,
  variables,
  values,
}: {
  accessibleUrl: string
  variables: WorkflowHiddenStartVariable[]
  values: Record<string, WorkflowLaunchInputValue>
}) => {
  const targetUrl = new URL(accessibleUrl, window.location.origin)
  variables.forEach((variable) => {
    const rawValue = values[variable.variable]
    const serializedValue = variable.type === InputVarType.checkbox
      ? String(Boolean(rawValue))
      : String(rawValue ?? '')

    targetUrl.searchParams.set(variable.variable, serializedValue)
  })

  return targetUrl.toString()
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
