import {
  memo,
  useCallback,
  useState,
} from 'react'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { generateNewNode } from '@/app/components/workflow/utils'
import { useStore } from '@/app/components/workflow/store'
import { useStoreApi } from 'reactflow'
import PluginDependency from '../../workflow/plugin-dependency'
import {
  useDSL,
  usePanelInteractions,
} from '@/app/components/workflow/hooks'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import WorkflowHeader from './workflow-header'
import WorkflowPanel from './workflow-panel'
import dynamic from 'next/dynamic'
import { BlockEnum } from '@/app/components/workflow/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import { useAutoOnboarding } from '../hooks/use-auto-onboarding'
import { useAvailableNodesMetaData } from '../hooks'

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

const WorkflowChildren = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])
  const showFeaturesPanel = useStore(s => s.showFeaturesPanel)
  const showImportDSLModal = useStore(s => s.showImportDSLModal)
  const setShowImportDSLModal = useStore(s => s.setShowImportDSLModal)
  const showOnboarding = useStore(s => s.showOnboarding)
  const setShowOnboarding = useStore(s => s.setShowOnboarding)
  const setHasSelectedStartNode = useStore(s => s.setHasSelectedStartNode)
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

  const handleCloseOnboarding = useCallback(() => {
    handleOnboardingClose()
  }, [handleOnboardingClose])

  const handleSelectStartNode = useCallback((nodeType: BlockEnum, toolConfig?: ToolDefaultValue) => {
    const nodeData = nodeType === BlockEnum.Start
      ? availableNodesMetaData.nodesMap?.[BlockEnum.Start]
      : { ...availableNodesMetaData.nodesMap?.[nodeType], ...toolConfig }

    const { newNode } = generateNewNode({
      data: {
        ...nodeData,
      } as any,
      position: START_INITIAL_POSITION,
    })

    const { setNodes, setEdges } = reactFlowStore.getState()
    setNodes([newNode])
    setEdges([])

    setShowOnboarding?.(false)
    setHasSelectedStartNode?.(true)

    handleSyncWorkflowDraft(true, false, {
      onSuccess: () => {
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
