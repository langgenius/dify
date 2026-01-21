import type {
  PluginDefaultValue,
  TriggerDefaultValue,
} from '@/app/components/workflow/block-selector/types'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import dynamic from 'next/dynamic'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useStoreApi } from 'reactflow'
import { DSL_EXPORT_CHECK, START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import {
  useAutoGenerateWebhookUrl,
  useDSL,
  usePanelInteractions,
} from '@/app/components/workflow/hooks'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { generateNewNode } from '@/app/components/workflow/utils'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import PluginDependency from '../../workflow/plugin-dependency'
import { useAvailableNodesMetaData } from '../hooks'
import { useAutoOnboarding } from '../hooks/use-auto-onboarding'
import WorkflowHeader from './workflow-header'
import WorkflowPanel from './workflow-panel'

const Features = dynamic(() => import('@/app/components/workflow/features'), {
  ssr: false,
})
const UpdateDSLModal = dynamic(() => import('@/app/components/workflow/update-dsl-modal'), {
  ssr: false,
})
const DSLExportConfirmModal = dynamic(() => import('@/app/components/workflow/dsl-export-confirm-modal'), {
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
  const { eventEmitter } = useEventEmitterContextContext()
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])
  const showFeaturesPanel = useStore(s => s.showFeaturesPanel)
  const showImportDSLModal = useStore(s => s.showImportDSLModal)
  const setShowImportDSLModal = useStore(s => s.setShowImportDSLModal)
  const showOnboarding = useStore(s => s.showOnboarding)
  const setShowOnboarding = useStore(s => s.setShowOnboarding)
  const setHasSelectedStartNode = useStore(s => s.setHasSelectedStartNode)
  const setShouldAutoOpenStartNodeSelector = useStore(s => s.setShouldAutoOpenStartNodeSelector)
  const reactFlowStore = useStoreApi()
  const availableNodesMetaData = useAvailableNodesMetaData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleOnboardingClose } = useAutoOnboarding()
  const {
    handlePaneContextmenuCancel,
  } = usePanelInteractions()
  const {
    exportCheck,
    handleExportDSL,
  } = useDSL()

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === DSL_EXPORT_CHECK)
      setSecretEnvList(v.payload.data as EnvironmentVariable[])
  })

  const autoGenerateWebhookUrl = useAutoGenerateWebhookUrl()

  const handleCloseOnboarding = useCallback(() => {
    handleOnboardingClose()
  }, [handleOnboardingClose])

  const handleSelectStartNode = useCallback((nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => {
    const nodeDefault = availableNodesMetaData.nodesMap?.[nodeType]
    if (!nodeDefault?.defaultValue)
      return

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

    const { setNodes, setEdges } = reactFlowStore.getState()
    setNodes([newNode])
    setEdges([])

    setShowOnboarding?.(false)
    setHasSelectedStartNode?.(true)
    setShouldAutoOpenStartNodeSelector?.(true)

    handleSyncWorkflowDraft(true, false, {
      onSuccess: () => {
        autoGenerateWebhookUrl(newNode.id)
        console.log('Node successfully saved to draft')
      },
      onError: () => {
        console.error('Failed to save node to draft')
      },
    })
  }, [availableNodesMetaData, setShowOnboarding, setHasSelectedStartNode, reactFlowStore, handleSyncWorkflowDraft])

  return (
    <>
      <PluginDependency />
      {
        showFeaturesPanel && <Features />
      }
      {
        showOnboarding && (
          <WorkflowOnboardingModal
            isShow={showOnboarding}
            onClose={handleCloseOnboarding}
            onSelectStartNode={handleSelectStartNode}
          />
        )
      }
      {
        showImportDSLModal && (
          <UpdateDSLModal
            onCancel={() => setShowImportDSLModal(false)}
            onBackup={exportCheck!}
            onImport={handlePaneContextmenuCancel}
          />
        )
      }
      {
        secretEnvList.length > 0 && (
          <DSLExportConfirmModal
            envList={secretEnvList}
            onConfirm={handleExportDSL!}
            onClose={() => setSecretEnvList([])}
          />
        )
      }
      <WorkflowHeader />
      <WorkflowPanel />
    </>
  )
}

export default memo(WorkflowChildren)
