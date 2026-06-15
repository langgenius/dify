import type { ValueSelector } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'
import { produce } from 'immer'
import {
  useEffect,
  useMemo,
} from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useCurrentProviderAndModel, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useDatasetsDetailStore } from '../../datasets-detail-store/store'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import { BlockEnum } from '../../types'
import useKnowledgeDatasetSelection from './hooks/use-knowledge-dataset-selection'
import useKnowledgeInputManager from './hooks/use-knowledge-input-manager'
import useKnowledgeMetadataConfig from './hooks/use-knowledge-metadata-config'
import useKnowledgeModelConfig from './hooks/use-knowledge-model-config'

const useConfig = (id: string, payload: KnowledgeRetrievalNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const startNode = getBeforeNodesInSameBranch(id).find(node => node.data.type === BlockEnum.Start)
  const startNodeId = startNode?.id
  const { inputs, setInputs: doSetInputs } = useNodeCrud<KnowledgeRetrievalNodeType>(id, payload)
  const updateDatasetsDetail = useDatasetsDetailStore(s => s.updateDatasetsDetail)
  const {
    inputRef,
    setInputs,
    handleQueryVarChange,
    handleQueryAttachmentChange,
  } = useKnowledgeInputManager({
    inputs,
    doSetInputs,
  })

  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const {
    currentModel: currentRerankModel,
    currentProvider: currentRerankProvider,
  } = useCurrentProviderAndModel(
    rerankModelList,
    rerankDefaultModel
      ? {
          ...rerankDefaultModel,
          provider: rerankDefaultModel.provider.provider,
        }
      : undefined,
  )

  const fallbackRerankModel = useMemo(() => ({
    provider: currentRerankProvider?.provider,
    model: currentRerankModel?.model,
  }), [currentRerankModel?.model, currentRerankProvider?.provider])

  const {
    selectedDatasets,
    selectedDatasetsLoaded,
    rerankModelOpen,
    setRerankModelOpen,
    handleOnDatasetsChange,
    showImageQueryVarSelector,
  } = useKnowledgeDatasetSelection({
    inputs,
    inputRef,
    setInputs,
    payloadRetrievalMode: payload.retrieval_mode,
    updateDatasetsDetail,
    fallbackRerankModel,
  })

  const {
    handleModelChanged,
    handleCompletionParamsChange,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
  } = useKnowledgeModelConfig({
    inputs,
    inputRef,
    setInputs,
    selectedDatasets,
    currentProvider,
    currentModel,
    fallbackRerankModel,
    hasRerankDefaultModel: Boolean(currentRerankModel && rerankDefaultModel),
  })

  useEffect(() => {
    const currentInputs = inputRef.current
    let nextQueryVariableSelector: ValueSelector = currentInputs.query_variable_selector
    if (isChatMode && currentInputs.query_variable_selector.length === 0 && startNodeId)
      nextQueryVariableSelector = [startNodeId, 'sys.query']

    setInputs(produce(currentInputs, (draft) => {
      draft.query_variable_selector = nextQueryVariableSelector
    }))
  }, [inputRef, isChatMode, setInputs, startNodeId])

  const metadataConfig = useKnowledgeMetadataConfig({
    id,
    inputRef,
    setInputs,
  })

  return {
    readOnly,
    inputs,
    handleQueryVarChange,
    handleQueryAttachmentChange,
    filterStringVar: metadataConfig.filterStringVar,
    filterFileVar: metadataConfig.filterFileVar,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    handleModelChanged,
    handleCompletionParamsChange,
    selectedDatasets: selectedDatasets.filter(d => d.name),
    selectedDatasetsLoaded,
    handleOnDatasetsChange,
    rerankModelOpen,
    setRerankModelOpen,
    handleMetadataFilterModeChange: metadataConfig.handleMetadataFilterModeChange,
    handleUpdateCondition: metadataConfig.handleUpdateCondition,
    handleAddCondition: metadataConfig.handleAddCondition,
    handleRemoveCondition: metadataConfig.handleRemoveCondition,
    handleToggleConditionLogicalOperator: metadataConfig.handleToggleConditionLogicalOperator,
    handleMetadataModelChange: metadataConfig.handleMetadataModelChange,
    handleMetadataCompletionParamsChange: metadataConfig.handleMetadataCompletionParamsChange,
    availableStringVars: metadataConfig.availableStringVars,
    availableStringNodesWithParent: metadataConfig.availableStringNodesWithParent,
    availableNumberVars: metadataConfig.availableNumberVars,
    availableNumberNodesWithParent: metadataConfig.availableNumberNodesWithParent,
    showImageQueryVarSelector,
  }
}

export default useConfig
