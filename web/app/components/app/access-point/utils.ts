import type { InputVar } from '@/app/components/workflow/types'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { BlockEnum, isTriggerNode } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

export type AccessPointAppInfo = AppDetailResponse & Partial<AppSSO>
export type PublishedWorkflow = FetchWorkflowDraftResponse | null | undefined

type AppRouteMode = Exclude<AppModeEnum, 'agent'>

const APP_API_REFERENCE_PATHS: Record<AppRouteMode, DocPathWithoutLang> = {
  'advanced-chat': '/api-reference/guides/chatflow',
  'agent-chat': '/api-reference/guides/chat',
  chat: '/api-reference/guides/chat',
  completion: '/api-reference/guides/completion',
  workflow: '/api-reference/guides/workflow',
}

export function getAppApiReferencePath(appMode: AppModeEnum) {
  if (appMode === 'agent') return undefined

  return APP_API_REFERENCE_PATHS[appMode]
}

export function getPublishedWorkflowState(
  appInfo: AccessPointAppInfo,
  workflow: PublishedWorkflow,
) {
  const isWorkflowApp = appInfo.mode === AppModeEnum.WORKFLOW
  const nodes = workflow?.graph?.nodes ?? []
  const hasStartNode = nodes.some((node) => node.data.type === BlockEnum.Start)
  const hasTriggerNode = nodes.some((node) => isTriggerNode(node.data.type))

  return {
    hasStartNode,
    hasTriggerNode,
    isUnpublished: isWorkflowApp && !workflow?.graph,
    isWorkflowApp,
  }
}

export function getBuiltInAccessUrls(appInfo: AccessPointAppInfo) {
  const appMode =
    appInfo.mode === AppModeEnum.COMPLETION || appInfo.mode === AppModeEnum.WORKFLOW
      ? appInfo.mode
      : AppModeEnum.CHAT

  return {
    api: appInfo.api_base_url ?? '',
    webApp: `${appInfo.site?.app_base_url ?? ''}${basePath}/${appMode}/${
      appInfo.site?.access_token ?? ''
    }`,
  }
}

export function getHiddenStartInputs(workflow: PublishedWorkflow) {
  const startNode = workflow?.graph?.nodes.find((node) => node.data.type === BlockEnum.Start)

  return ((startNode?.data as { variables?: InputVar[] } | undefined)?.variables ?? []).filter(
    (variable) => variable.hide === true,
  )
}

export function isAdvancedApp(appInfo: AccessPointAppInfo) {
  return appInfo.mode === AppModeEnum.WORKFLOW || appInfo.mode === AppModeEnum.ADVANCED_CHAT
}
