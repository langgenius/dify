import type { AppPublisherPublishParams } from '../types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanManageTools } from '@/app/components/tools/hooks/use-tool-permissions'
import { useConfigureButton } from '@/app/components/tools/workflow-tool/hooks/use-configure-button'
import { appDefaultIconBackground } from '@/config'
import { AppModeEnum } from '@/types/app'

type UseWorkflowToolParams = {
  appDescription?: string
  appIcon?: string
  appIconBackground?: string | null
  appIconType?: string | null
  appId?: string
  appMode?: AppModeEnum
  appName?: string
  appPublished: boolean
  hasHumanInputNode: boolean
  hasPublishedVersion: boolean
  hasTriggerNode: boolean
  inputs?: InputVar[]
  outputs?: Variable[]
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
  hasHumanInputNode,
  hasPublishedVersion,
  hasTriggerNode,
  inputs,
  onClosePublisher,
  onPublish,
  onRefreshData,
  outputs,
  toolPublished,
  workflowToolAvailable,
}: UseWorkflowToolParams) {
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const canManageTools = useCanManageTools()
  const visible = appMode === AppModeEnum.WORKFLOW && !hasHumanInputNode && !hasTriggerNode
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

  function openDrawer() {
    if (!canManageTools) return

    onClosePublisher()
    setDrawerOpen(true)
  }

  return {
    availableForUser: workflowToolAvailable && canManageTools,
    canManageTools,
    closeDrawer,
    configuration,
    drawerOpen,
    message,
    openDrawer,
    published,
  }
}
