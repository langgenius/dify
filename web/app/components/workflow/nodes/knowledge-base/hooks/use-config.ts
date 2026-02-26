import type {
  KnowledgeBaseNodeType,
  RerankingModel,
  SummaryIndexSetting,
} from '../types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { produce } from 'immer'
import {
  useCallback,
} from 'react'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import { DEFAULT_WEIGHTED_SCORE, RerankingModeEnum } from '@/models/datasets'
import {
  ChunkStructureEnum,
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
  WeightedScoreEnum,
} from '../types'
import { isHighQualitySearchMethod } from '../utils'

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

  const getDefaultWeights = useCallback(({
    embeddingModel,
    embeddingModelProvider,
  }: {
    embeddingModel: string
    embeddingModelProvider: string
  }) => {
    return {
      vector_setting: {
        vector_weight: DEFAULT_WEIGHTED_SCORE.other.semantic,
        embedding_provider_name: embeddingModelProvider || '',
        embedding_model_name: embeddingModel,
      },
      keyword_setting: {
        keyword_weight: DEFAULT_WEIGHTED_SCORE.other.keyword,
      },
    }
  }, [])

  const handleChunkStructureChange = useCallback((chunkStructure: ChunkStructureEnum) => {
    const nodeData = getNodeData()
    const {
      indexing_technique,
      retrieval_model,
      chunk_structure,
      index_chunk_variable_selector,
    } = nodeData?.data || {}
    const { search_method } = retrieval_model || {}
    handleNodeDataUpdate({
      chunk_structure: chunkStructure,
      indexing_technique: (chunkStructure === ChunkStructureEnum.parent_child || chunkStructure === ChunkStructureEnum.question_answer) ? IndexMethodEnum.QUALIFIED : indexing_technique,
      retrieval_model: {
        ...retrieval_model,
        search_method: ((chunkStructure === ChunkStructureEnum.parent_child || chunkStructure === ChunkStructureEnum.question_answer) && !isHighQualitySearchMethod(search_method)) ? RetrievalSearchMethodEnum.keywordSearch : search_method,
      },
      index_chunk_variable_selector: chunkStructure === chunk_structure ? index_chunk_variable_selector : [],
    })
  }, [handleNodeDataUpdate, getNodeData])

  const handleIndexMethodChange = useCallback((indexMethod: IndexMethodEnum) => {
    const nodeData = getNodeData()

    handleNodeDataUpdate(produce(nodeData?.data as KnowledgeBaseNodeType, (draft) => {
      draft.indexing_technique = indexMethod

      if (indexMethod === IndexMethodEnum.ECONOMICAL)
        draft.retrieval_model.search_method = RetrievalSearchMethodEnum.keywordSearch
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
    const defaultWeights = getDefaultWeights({
      embeddingModel,
      embeddingModelProvider,
    })
    const changeData = {
      embedding_model: embeddingModel,
      embedding_model_provider: embeddingModelProvider,
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
      },
    }
    if (changeData.retrieval_model.weights) {
      changeData.retrieval_model = {
        ...changeData.retrieval_model,
        weights: {
          ...changeData.retrieval_model.weights,
          vector_setting: {
            ...changeData.retrieval_model.weights.vector_setting,
            embedding_provider_name: embeddingModelProvider,
            embedding_model_name: embeddingModel,
          },
        },
      }
    }
    else {
      changeData.retrieval_model = {
        ...changeData.retrieval_model,
        weights: defaultWeights,
      }
    }
    handleNodeDataUpdate(changeData)
  }, [getNodeData, getDefaultWeights, handleNodeDataUpdate])

  const handleRetrievalSearchMethodChange = useCallback((searchMethod: RetrievalSearchMethodEnum) => {
    const nodeData = getNodeData()
    const changeData = {
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        search_method: searchMethod,
        reranking_mode: nodeData?.data.retrieval_model.reranking_mode || RerankingModeEnum.RerankingModel,
      },
    }
    if (searchMethod === RetrievalSearchMethodEnum.hybrid) {
      changeData.retrieval_model = {
        ...changeData.retrieval_model,
        reranking_enable: changeData.retrieval_model.reranking_mode === RerankingModeEnum.RerankingModel,
      }
    }
    handleNodeDataUpdate(changeData)
  }, [getNodeData, handleNodeDataUpdate])

  const handleHybridSearchModeChange = useCallback((hybridSearchMode: HybridSearchModeEnum) => {
    const nodeData = getNodeData()
    const defaultWeights = getDefaultWeights({
      embeddingModel: nodeData?.data.embedding_model || '',
      embeddingModelProvider: nodeData?.data.embedding_model_provider || '',
    })
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        reranking_mode: hybridSearchMode,
        reranking_enable: hybridSearchMode === HybridSearchModeEnum.RerankingModel,
        weights: nodeData?.data.retrieval_model.weights || defaultWeights,
      },
    })
  }, [getNodeData, getDefaultWeights, handleNodeDataUpdate])

  const handleRerankingModelEnabledChange = useCallback((rerankingModelEnabled: boolean) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        reranking_enable: rerankingModelEnabled,
      },
    })
  }, [getNodeData, handleNodeDataUpdate])

  const handleWeighedScoreChange = useCallback((weightedScore: { value: number[] }) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      retrieval_model: {
        ...nodeData?.data.retrieval_model,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            ...nodeData?.data.retrieval_model.weights?.vector_setting,
            vector_weight: weightedScore.value[0],
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

  const handleSummaryIndexSettingChange = useCallback((summaryIndexSetting: SummaryIndexSetting) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      summary_index_setting: {
        ...nodeData?.data.summary_index_setting,
        ...summaryIndexSetting,
      },
    })
  }, [handleNodeDataUpdate, getNodeData])

  return {
    handleChunkStructureChange,
    handleIndexMethodChange,
    handleKeywordNumberChange,
    handleEmbeddingModelChange,
    handleRetrievalSearchMethodChange,
    handleHybridSearchModeChange,
    handleRerankingModelEnabledChange,
    handleWeighedScoreChange,
    handleRerankingModelChange,
    handleTopKChange,
    handleScoreThresholdChange,
    handleScoreThresholdEnabledChange,
    handleInputVariableChange,
    handleSummaryIndexSettingChange,
  }
}
