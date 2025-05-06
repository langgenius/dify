import {
  useCallback,
} from 'react'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type {
  ChunkStructureEnum,
  HybridSearchModeEnum,
  IndexMethodEnum,
  KnowledgeBaseNodeType,
  RerankingModel,
  RetrievalSearchMethodEnum,
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
    handleNodeDataUpdate({ chunk_structure: chunkStructure })
  }, [handleNodeDataUpdate])

  const handleIndexMethodChange = useCallback((indexMethod: IndexMethodEnum) => {
    handleNodeDataUpdate({ indexing_technique: indexMethod })
  }, [handleNodeDataUpdate])

  const handleKeywordNumberChange = useCallback((keywordNumber: number) => {
    handleNodeDataUpdate({ keyword_number: keywordNumber })
  }, [handleNodeDataUpdate])

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

  return {
    handleChunkStructureChange,
    handleIndexMethodChange,
    handleKeywordNumberChange,
    handleRetrievalSearchMethodChange,
    handleHybridSearchModeChange,
    handleWeighedScoreChange,
    handleRerankingModelChange,
  }
}
