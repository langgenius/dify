import type { BlockDefaultValue } from '@/app/components/workflow/block-selector/types'
import type { ExportSecretEnvironmentVariable } from '@/app/components/workflow/export-secret-env-event'
import type { BlockEnum } from '@/app/components/workflow/types'
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
import { useDSL } from '@/app/components/workflow/hooks/use-DSL'
import { usePanelInteractions } from '@/app/components/workflow/hooks/use-panel-interactions'
import {
  getStartNodeData,
  useSelectStartNode,
} from '@/app/components/workflow/hooks/use-select-start-node'
import { useWorkflowNodeCatalog } from '@/app/components/workflow/node-catalog'
import PluginDependency from '@/app/components/workflow/plugin-dependency'
import { useStore } from '@/app/components/workflow/store'
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
  const selectStartNode = useSelectStartNode()
  const availableNodesMetaData = useWorkflowNodeCatalog()
  const { handleOnboardingClose } = useAutoOnboarding()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const { exportCheck, handleExportDSL, isExporting } = useDSL()

  eventEmitter?.useSubscription((event) => {
    if (isExportSecretEnvironmentEvent(event))
      exportSecretsDialog.openWithPayload(event.payload.data)
  })

  const handleCloseOnboarding = useCallback(() => {
    handleOnboardingClose()
  }, [handleOnboardingClose])

  const handleSelectStartNode = useCallback(
    (nodeType: BlockEnum, toolConfig?: BlockDefaultValue) => {
      if (!canEdit) return

      const nodeDefault = availableNodesMetaData.nodesMap?.[nodeType]
      if (!nodeDefault?.defaultValue) return

      const nodeData = getStartNodeData(nodeType, nodeDefault.defaultValue, toolConfig)

      const { newNode } = generateNewNode({
        data: nodeData,
        position: START_INITIAL_POSITION,
      })

      selectStartNode(
        () => newNode,
        () => {
          setShowOnboarding?.(false)
          setHasSelectedStartNode?.(true)
          setShouldAutoOpenStartNodeSelector?.(true)
        },
        true,
      )
    },
    [
      selectStartNode,
      availableNodesMetaData,
      canEdit,
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
