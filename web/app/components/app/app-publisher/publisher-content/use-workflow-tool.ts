import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { AppPublisherPublishParams } from '../types'
import type { WorkflowToolOutputVariable } from '@/app/components/tools/types'
import type { InputVar } from '@/app/components/workflow/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanManageTools } from '@/app/components/tools/hooks/use-tool-permissions'
import { useConfigureButton } from '@/app/components/tools/workflow-tool/hooks/use-configure-button'
import { appDefaultIconBackground } from '@/config'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

type UseWorkflowToolParams = {
  appDescription?: string
  appIcon?: string | null
  appIconBackground?: string | null
  appIconType?: string | null
  appId?: string
  appMode?: AppMode
  appName?: string
  appPublished: boolean
  hasPublishedVersion: boolean
  hasTriggerNode: boolean
  inputs?: InputVar[]
  outputs?: WorkflowToolOutputVariable[]
  /** Whether the publish menu, which renders the load error, is open. */
  publisherOpen: boolean
  toolPublished?: boolean
  workflowToolAvailable: boolean
  onClosePublisher: () => void
  onPublish: (params?: AppPublisherPublishParams) => Promise<void>
  onRefreshData?: () => void
}

export function useWorkflowTool({
  appDescription,
  appIcon,
  appIconBackground,
  appIconType,
  appId,
  appMode,
  appName,
  appPublished,
  hasPublishedVersion,
  hasTriggerNode,
  inputs,
  onClosePublisher,
  onPublish,
  onRefreshData,
  outputs,
  publisherOpen,
  toolPublished,
  workflowToolAvailable,
}: UseWorkflowToolParams) {
  const { t } = useTranslation(['workflow'] as const)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const canManageTools = useCanManageTools()
  const visible = appMode === 'workflow' && !hasTriggerNode
  const published = Boolean(toolPublished)
  const message =
    !hasPublishedVersion || !workflowToolAvailable
      ? t(($) => $['common.workflowAsToolDisabledHint'], { ns: 'workflow' })
      : undefined
  const icon = {
    content: (appIconType === 'image' ? '🤖' : appIcon) || '🤖',
    background:
      (appIconType === 'image' ? appDefaultIconBackground : appIconBackground) ||
      appDefaultIconBackground,
  }

  function closeDrawer() {
    setDrawerOpen(false)
  }

  const configuration = useConfigureButton({
    enabled: visible && canManageTools,
    published,
    detailNeedUpdate: published && appPublished,
    workflowAppId: appId ?? '',
    icon,
    name: appName ?? '',
    description: appDescription ?? '',
    inputs,
    outputs,
    handlePublish: onPublish,
    onRefreshData,
    onConfigured: closeDrawer,
  })
  // Without the published detail the drawer would start from empty parameters and no tool id, so
  // a failed first load blocks configuring until a retry loads it. The publisher's actions render
  // it, so it is claimed only while the menu is open. `useConfigureButton` exposes the detail read's
  // failed first load only.
  const detailLoadError = published ? configuration.loadError : null
  const detailLoadBlocked = detailLoadError != null
  const detailLoad = useOwnedQueryErrors(
    publisherOpen
      ? [
          {
            data: undefined,
            error: detailLoadError,
            isError: detailLoadBlocked,
            isFetching: configuration.isRetrying,
            refetch: configuration.retryLoad,
          },
        ]
      : [],
  )
  const loadErrorMessage = useRequestErrorMessage(
    detailLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
  )

  function openDrawer() {
    if (!canManageTools || detailLoadBlocked) return

    onClosePublisher()
    setDrawerOpen(true)
  }

  return {
    availableForUser: workflowToolAvailable && canManageTools,
    canManageTools,
    closeDrawer,
    configuration,
    drawerOpen: drawerOpen && !detailLoadBlocked,
    isRetrying: detailLoad?.retrying ?? false,
    loadErrorMessage,
    message,
    retryLoad: detailLoad?.retry ?? configuration.retryLoad,
    openDrawer,
    published,
    visible,
  }
}
