import type {
  BlockDefaultValue,
  TriggerDefaultValue,
} from '@/app/components/workflow/block-selector/types'
import type { ExportSecretEnvironmentVariable } from '@/app/components/workflow/export-secret-env-event'
import { AlertDialog, createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import { memo, useCallback, useState } from 'react'
import { ExportSecretsDialogContent } from '@/app/components/app/export-secrets-dialog'
import { START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import {
  isChatflowAtom,
  workflowAppIdentityAtom,
} from '@/app/components/workflow/editor-resource/state'
import { isExportSecretEnvironmentEvent } from '@/app/components/workflow/export-secret-env-event'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useAutoGenerateWebhookUrl } from '@/app/components/workflow/hooks/use-auto-generate-webhook-url'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useDSL } from '@/app/components/workflow/hooks/use-DSL'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { usePanelInteractions } from '@/app/components/workflow/hooks/use-panel-interactions'
import { useWorkflowNodeCatalog } from '@/app/components/workflow/node-catalog'
import PluginDependency from '@/app/components/workflow/plugin-dependency'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { generateNewNode } from '@/app/components/workflow/utils'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useAutoOnboarding } from '../hooks/use-auto-onboarding'
import WorkflowHeader from './workflow-header'

const Features = dynamic(() => import('@/app/components/workflow/features'), {
  ssr: false,
})
const UpdateDSLModal = dynamic(() => import('@/app/components/workflow/update-dsl-modal'), {
  ssr: false,
})
const WorkflowOnboardingModal = dynamic(() => import('./workflow-onboarding-modal'), {
  ssr: false,
})

const getTriggerPluginNodeData = (
  triggerConfig: TriggerDefaultValue,
  fallbackTitle?: string,
  fallbackDesc?: string,
) => {
  return {
    plugin_id: triggerConfig.plugin_id,
    provider_id: triggerConfig.provider_name,
    provider_type: triggerConfig.provider_type,
    provider_name: triggerConfig.provider_name,
    event_name: triggerConfig.event_name,
    event_label: triggerConfig.event_label,
    event_description: triggerConfig.event_description,
    title: triggerConfig.event_label || triggerConfig.title || fallbackTitle,
    desc: triggerConfig.event_description || fallbackDesc,
    output_schema: { ...triggerConfig.output_schema },
    parameters_schema: triggerConfig.paramSchemas ? [...triggerConfig.paramSchemas] : [],
    config: { ...triggerConfig.params },
    subscription_id: triggerConfig.subscription_id,
    plugin_unique_identifier: triggerConfig.plugin_unique_identifier,
    is_team_authorization: triggerConfig.is_team_authorization,
    meta: triggerConfig.meta ? { ...triggerConfig.meta } : undefined,
  }
}

const WorkflowChildren = () => {
  const appId = useAtomValue(workflowAppIdentityAtom).appId
  const isChatflow = useAtomValue(isChatflowAtom)
  const { eventEmitter } = useEventEmitterContextContext()
  const [exportSecretsDialog] = useState(() =>
    createAlertDialogHandle<ExportSecretEnvironmentVariable[]>(),
  )
  const showFeaturesPanel = useStore((s) => s.showFeaturesPanel)
  const showImportDSLModal = useStore((s) => s.showImportDSLModal)
  const setShowImportDSLModal = useStore((s) => s.setShowImportDSLModal)
  const showOnboarding = useStore((s) => s.showOnboarding)
  const canImportExportDSL = useHooksStore((s) => s.accessControl.canImportExportDSL)
  const canEdit = useHooksStore((s) => s.accessControl.canEdit)
  const setShowOnboarding = useStore((s) => s.setShowOnboarding)
  const setHasSelectedStartNode = useStore((s) => s.setHasSelectedStartNode)
  const setShouldAutoOpenStartNodeSelector = useStore((s) => s.setShouldAutoOpenStartNodeSelector)
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const availableNodesMetaData = useWorkflowNodeCatalog()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleOnboardingClose } = useAutoOnboarding()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const { exportCheck, handleExportDSL, isExporting } = useDSL()

  eventEmitter?.useSubscription((event) => {
    if (isExportSecretEnvironmentEvent(event))
      exportSecretsDialog.openWithPayload(event.payload.data)
  })

  const autoGenerateWebhookUrl = useAutoGenerateWebhookUrl()

  const handleCloseOnboarding = useCallback(() => {
    handleOnboardingClose()
  }, [handleOnboardingClose])

  const handleSelectStartNode = useCallback(
    (nodeType: BlockEnum, toolConfig?: BlockDefaultValue) => {
      if (!canEdit) return

      const { nodes, setNodes, setEdges } = collaborativeWorkflow.getState()
      if (nodes.some((node) => node.data.type !== BlockEnum.StartPlaceholder)) {
        handleOnboardingClose()
        return
      }

      const nodeDefault = availableNodesMetaData.nodesMap?.[nodeType]
      if (!nodeDefault?.defaultValue) return

      const baseNodeData = { ...nodeDefault.defaultValue }

      const mergedNodeData = (() => {
        if (nodeType !== BlockEnum.TriggerPlugin || !toolConfig) {
          return {
            ...baseNodeData,
            ...toolConfig,
          }
        }

        const triggerNodeData = getTriggerPluginNodeData(
          toolConfig as TriggerDefaultValue,
          baseNodeData.title,
          baseNodeData.desc,
        )

        return {
          ...baseNodeData,
          ...triggerNodeData,
          config: {
            ...(baseNodeData as { config?: Record<string, any> }).config,
            ...triggerNodeData.config,
          },
        }
      })()

      const { newNode } = generateNewNode({
        data: {
          ...mergedNodeData,
        } as any,
        position: START_INITIAL_POSITION,
      })

      if (!setNodes([newNode])) return
      setEdges([])

      setShowOnboarding?.(false)
      setHasSelectedStartNode?.(true)
      setShouldAutoOpenStartNodeSelector?.(true)

      handleSyncWorkflowDraft(true, false, {
        onSuccess: () => {
          autoGenerateWebhookUrl(newNode.id)
        },
        onError: () => {
          console.error('Failed to save node to draft')
        },
      })
    },
    [
      availableNodesMetaData,
      autoGenerateWebhookUrl,
      canEdit,
      collaborativeWorkflow,
      handleOnboardingClose,
      handleSyncWorkflowDraft,
      setHasSelectedStartNode,
      setShouldAutoOpenStartNodeSelector,
      setShowOnboarding,
    ],
  )

  return (
    <>
      <PluginDependency />
      {showFeaturesPanel && <Features />}
      {canEdit && showOnboarding && (
        <WorkflowOnboardingModal
          isShow={showOnboarding}
          onClose={handleCloseOnboarding}
          onSelectStartNode={handleSelectStartNode}
        />
      )}
      {appId && canImportExportDSL && showImportDSLModal && (
        <UpdateDSLModal
          appId={appId}
          appMode={isChatflow ? 'advanced-chat' : 'workflow'}
          open
          onOpenChange={(open) => setShowImportDSLModal(open)}
          onBackup={exportCheck!}
          onImport={handlePaneContextmenuCancel}
        />
      )}
      {canImportExportDSL && (
        <AlertDialog
          handle={exportSecretsDialog}
          onOpenChange={(open, details) => {
            if (!open && isExporting && details.reason !== 'imperative-action') details.cancel()
          }}
        >
          {({ payload }) =>
            payload && (
              <ExportSecretsDialogContent
                envList={payload}
                isExporting={isExporting}
                onConfirm={async (includeSecret) => {
                  if (isExporting) return
                  if (await handleExportDSL?.(includeSecret)) exportSecretsDialog.close()
                }}
              />
            )
          }
        </AlertDialog>
      )}
      <WorkflowHeader />
    </>
  )
}

export default memo(WorkflowChildren)
