import {
  useCallback,
  useEffect,
} from 'react'
import { produce } from 'immer'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type { ValueSelector } from '@/app/components/workflow/types'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  ChunkStructureEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from '../types'
import type {
  HybridSearchModeEnum,
  KnowledgeBaseNodeType,
  RerankingModel,
} from '../types'

export const useConfig = (id: string) => {
  const store = useStoreApi()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const getNodeData = useCallback(() => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === id)
  }, [store, id])

  const handleNodeDataUpdate = useCallback((data: Partial<KnowledgeBaseNodeType>) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data,
    })
  }, [id, handleNodeDataUpdateWithSyncDraft])

  const handleChunkStructureChange = useCallback((chunkStructure: ChunkStructureEnum) => {
    const nodeData = getNodeData()
    const { indexing_technique } = nodeData?.data
    handleNodeDataUpdate({
      chunk_structure: chunkStructure,
      indexing_technique: chunkStructure === ChunkStructureEnum.parent_child ? IndexMethodEnum.QUALIFIED : indexing_technique,
    })
  }, [handleNodeDataUpdate, getNodeData])

  const handleIndexMethodChange = useCallback((indexMethod: IndexMethodEnum) => {
    const nodeData = getNodeData()

    handleNodeDataUpdate(produce(nodeData?.data as KnowledgeBaseNodeType, (draft) => {
      draft.indexing_technique = indexMethod

      if (indexMethod === IndexMethodEnum.ECONOMICAL)
        draft.retrieval_model.search_method = RetrievalSearchMethodEnum.invertedIndex
      else if (indexMethod === IndexMethodEnum.QUALIFIED)
        draft.retrieval_model.search_method = RetrievalSearchMethodEnum.semantic
    }))
  }, [handleNodeDataUpdate, getNodeData])

  const handleKeywordNumberChange = useCallback((keywordNumber: number) => {
    handleNodeDataUpdate({ keyword_number: keywordNumber })
  }, [handleNodeDataUpdate])

  const handleEmbeddingModelChange = useCallback(({
    embeddingModel,
    embeddingModelProvider,
  }: {
    embeddingModel: string
    embeddingModelProvider: string
  }) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      embedding_model: embeddingModel,
      embedding_model_provider: embeddingModelProvider,
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        vector_setting: {
          ...nodeData?.data.retrieval_model.vector_setting,
          embedding_provider_name: embeddingModelProvider,
          embedding_model_name: embeddingModel,
        },
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleRetrievalSearchMethodChange = useCallback((searchMethod: RetrievalSearchMethodEnum) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        search_method: searchMethod,
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleHybridSearchModeChange = useCallback((hybridSearchMode: HybridSearchModeEnum) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        hybridSearchMode,
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleWeighedScoreChange = useCallback((weightedScore: { value: number[] }) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        weights: {
          weight_type: 'weighted_score',
          vector_setting: {
            vector_weight: weightedScore.value[0],
            embedding_provider_name: '',
            embedding_model_name: '',
          },
          keyword_setting: {
            keyword_weight: weightedScore.value[1],
          },
        },
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleRerankingModelChange = useCallback((rerankingModel: RerankingModel) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        reranking_model: {
          reranking_provider_name: rerankingModel.reranking_provider_name,
          reranking_model_name: rerankingModel.reranking_model_name,
        },
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleTopKChange = useCallback((topK: number) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        top_k: topK,
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleScoreThresholdChange = useCallback((scoreThreshold: number) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        score_threshold: scoreThreshold,
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleScoreThresholdEnabledChange = useCallback((isEnabled: boolean) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        score_threshold_enabled: isEnabled,
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleInputVariableChange = useCallback((inputVariable: string | ValueSelector) => {
    handleNodeDataUpdate({
      index_chunk_variable_selector: Array.isArray(inputVariable) ? inputVariable : [],
    })
  }, [handleNodeDataUpdate])

  const {
    currentModel,
    currentProvider,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textEmbedding)

  const handleInitConfig = useCallback(() => {
    const nodeData = getNodeData()

    if (!nodeData?.data.embedding_model && !nodeData?.data.embedding_model_provider && currentModel && currentProvider) {
      handleEmbeddingModelChange({
        embeddingModel: currentModel.model,
        embeddingModelProvider: currentProvider.provider,
      })
    }
  }, [
    getNodeData,
    handleEmbeddingModelChange,
    currentModel,
    currentProvider,
  ])

  useEffect(() => {
    handleInitConfig()
  }, [handleInitConfig])

  return {
    handleChunkStructureChange,
    handleIndexMethodChange,
    handleKeywordNumberChange,
    handleEmbeddingModelChange,
    handleRetrievalSearchMethodChange,
    handleHybridSearchModeChange,
    handleWeighedScoreChange,
    handleRerankingModelChange,
    handleTopKChange,
    handleScoreThresholdChange,
    handleScoreThresholdEnabledChange,
    handleInputVariableChange,
  }
}
