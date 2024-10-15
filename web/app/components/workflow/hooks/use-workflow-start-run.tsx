import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '../store'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '../types'
import type { KnowledgeRetrievalNodeType } from '../nodes/knowledge-retrieval/types'
import type { Node } from '../types'
import { useWorkflow } from './use-workflow'
import {
  useIsChatMode,
  useNodesSyncDraft,
  useWorkflowInteractions,
  useWorkflowRun,
} from './index'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useCurrentProviderAndModel, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import KnowledgeRetrievalDefault from '@/app/components/workflow/nodes/knowledge-retrieval/default'
import Toast from '@/app/components/base/toast'

export const useWorkflowStartRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const isChatMode = useIsChatMode()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleRun } = useWorkflowRun()
  const { isFromStartNode } = useWorkflow()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { checkValid: checkKnowledgeRetrievalValid } = KnowledgeRetrievalDefault
  const { t } = useTranslation()
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const {
    currentModel,
  } = useCurrentProviderAndModel(
    rerankModelList,
    rerankDefaultModel
      ? {
        ...rerankDefaultModel,
        provider: rerankDefaultModel.provider.provider,
      }
      : undefined,
  )

  const handleWorkflowStartRunInWorkflow = useCallback(async () => {
    const {
      workflowRunningData,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const knowledgeRetrievalNodes = nodes.filter((node: Node<KnowledgeRetrievalNodeType>) =>
      node.data.type === BlockEnum.KnowledgeRetrieval,
    )
    const startVariables = startNode?.data.variables || []
    const fileSettings = featuresStore!.getState().features.file
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
    } = workflowStore.getState()

    if (knowledgeRetrievalNodes.length > 0) {
      for (const node of knowledgeRetrievalNodes) {
        if (isFromStartNode(node.id)) {
          const res = checkKnowledgeRetrievalValid(node.data, t)
          if (!res.isValid || !currentModel || !rerankDefaultModel) {
            const errorMessage = res.errorMessage
            if (errorMessage) {
              Toast.notify({
                type: 'error',
                message: errorMessage,
              })
              return false
            }
            else {
              Toast.notify({
                type: 'error',
                message: t('appDebug.datasetConfig.rerankModelRequired'),
              })
              return false
            }
          }
        }
      }
    }

    setShowEnvPanel(false)

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    if (!startVariables.length && !fileSettings?.image?.enabled) {
      await doSyncWorkflowDraft()
      handleRun({ inputs: {}, files: [] })
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(false)
    }
    else {
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(true)
    }
  }, [store, workflowStore, featuresStore, handleCancelDebugAndPreviewPanel, handleRun, doSyncWorkflowDraft])

  const handleWorkflowStartRunInChatflow = useCallback(async () => {
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setHistoryWorkflowData,
      setShowEnvPanel,
      setShowChatVariablePanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)
    setShowChatVariablePanel(false)

    if (showDebugAndPreviewPanel)
      handleCancelDebugAndPreviewPanel()
    else
      setShowDebugAndPreviewPanel(true)

    setHistoryWorkflowData(undefined)
  }, [workflowStore, handleCancelDebugAndPreviewPanel])

  const handleStartWorkflowRun = useCallback(() => {
    if (!isChatMode)
      handleWorkflowStartRunInWorkflow()
    else
      handleWorkflowStartRunInChatflow()
  }, [isChatMode, handleWorkflowStartRunInWorkflow, handleWorkflowStartRunInChatflow])

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowStartRunInChatflow,
  }
}
