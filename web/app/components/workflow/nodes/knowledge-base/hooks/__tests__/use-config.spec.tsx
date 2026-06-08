import type { KnowledgeBaseNodeType } from '../../types'
import { act } from '@testing-library/react'
import {
  createNode,
  createNodeDataFactory,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { RerankingModeEnum } from '@/models/datasets'
import {
  ChunkStructureEnum,
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
  WeightedScoreEnum,
} from '../../types'
import { useConfig } from '../use-config'

const mockHandleNodeDataUpdateWithSyncDraft = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodeDataUpdate: () => ({
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
  }),
}))

const createNodeData = createNodeDataFactory<KnowledgeBaseNodeType>({
  title: 'Knowledge Base',
  desc: '',
  type: 'knowledge-base' as KnowledgeBaseNodeType['type'],
  index_chunk_variable_selector: ['chunks', 'results'],
  chunk_structure: ChunkStructureEnum.general,
  indexing_technique: IndexMethodEnum.QUALIFIED,
  embedding_model: 'text-embedding-3-large',
  embedding_model_provider: 'openai',
  keyword_number: 3,
  retrieval_model: {
    search_method: RetrievalSearchMethodEnum.semantic,
    reranking_enable: false,
    reranking_mode: RerankingModeEnum.RerankingModel,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  },
  summary_index_setting: {
    enable: false,
    summary_prompt: 'existing prompt',
  },
})

const renderConfigHook = (nodeData: KnowledgeBaseNodeType) =>
  renderWorkflowFlowHook(() => useConfig('knowledge-base-node'), {
    nodes: [
      createNode({
        id: 'knowledge-base-node',
        data: nodeData,
      }),
    ],
    edges: [],
  })

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should preserve the current chunk variable selector when the chunk structure does not change', () => {
    const { result } = renderConfigHook(createNodeData())

    act(() => {
      result.current.handleChunkStructureChange(ChunkStructureEnum.general)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        chunk_structure: ChunkStructureEnum.general,
        index_chunk_variable_selector: ['chunks', 'results'],
      }),
    })
  })

  it('should reset chunk variables and keep a high-quality search method when switching chunk structures', () => {
    const { result } = renderConfigHook(createNodeData({
      retrieval_model: {
        search_method: RetrievalSearchMethodEnum.keywordSearch,
        reranking_enable: false,
        top_k: 3,
        score_threshold_enabled: false,
        score_threshold: 0.5,
      },
    }))

    act(() => {
      result.current.handleChunkStructureChange(ChunkStructureEnum.parent_child)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        chunk_structure: ChunkStructureEnum.parent_child,
        indexing_technique: IndexMethodEnum.QUALIFIED,
        index_chunk_variable_selector: [],
        retrieval_model: expect.objectContaining({
          search_method: RetrievalSearchMethodEnum.keywordSearch,
        }),
      }),
    })
  })

  it('should preserve semantic search when switching to a structured chunk mode from a high-quality search method', () => {
    const { result } = renderConfigHook(createNodeData({
      retrieval_model: {
        search_method: RetrievalSearchMethodEnum.semantic,
        reranking_enable: false,
        top_k: 3,
        score_threshold_enabled: false,
        score_threshold: 0.5,
      },
    }))

    act(() => {
      result.current.handleChunkStructureChange(ChunkStructureEnum.question_answer)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        chunk_structure: ChunkStructureEnum.question_answer,
        retrieval_model: expect.objectContaining({
          search_method: RetrievalSearchMethodEnum.semantic,
        }),
      }),
    })
  })

  it('should update the index method and keyword number', () => {
    const { result } = renderConfigHook(createNodeData())

    act(() => {
      result.current.handleIndexMethodChange(IndexMethodEnum.ECONOMICAL)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        indexing_technique: IndexMethodEnum.ECONOMICAL,
        retrieval_model: expect.objectContaining({
          search_method: RetrievalSearchMethodEnum.keywordSearch,
        }),
      }),
    })

    act(() => {
      result.current.handleIndexMethodChange(IndexMethodEnum.QUALIFIED)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        indexing_technique: IndexMethodEnum.QUALIFIED,
        retrieval_model: expect.objectContaining({
          search_method: RetrievalSearchMethodEnum.semantic,
        }),
      }),
    })

    act(() => {
      result.current.handleKeywordNumberChange(9)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: {
        keyword_number: 9,
      },
    })
  })

  it('should create default weights when embedding weights are missing and default reranking mode when switching away from hybrid', () => {
    const { result } = renderConfigHook(createNodeData({
      retrieval_model: {
        search_method: RetrievalSearchMethodEnum.semantic,
        reranking_enable: false,
        top_k: 3,
        score_threshold_enabled: false,
        score_threshold: 0.5,
      },
    }))

    act(() => {
      result.current.handleEmbeddingModelChange({
        embeddingModel: 'text-embedding-3-small',
        embeddingModelProvider: 'openai',
      })
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          weights: expect.objectContaining({
            vector_setting: expect.objectContaining({
              embedding_provider_name: 'openai',
              embedding_model_name: 'text-embedding-3-small',
            }),
            keyword_setting: expect.objectContaining({
              keyword_weight: 0.3,
            }),
          }),
        }),
      }),
    })

    act(() => {
      result.current.handleRetrievalSearchMethodChange(RetrievalSearchMethodEnum.fullText)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          search_method: RetrievalSearchMethodEnum.fullText,
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
      }),
    })
  })

  it('should update embedding model weights and retrieval search method defaults', () => {
    const { result } = renderConfigHook(createNodeData({
      retrieval_model: {
        search_method: RetrievalSearchMethodEnum.semantic,
        reranking_enable: false,
        reranking_mode: RerankingModeEnum.RerankingModel,
        reranking_model: {
          reranking_provider_name: '',
          reranking_model_name: '',
        },
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.8,
            embedding_provider_name: 'openai',
            embedding_model_name: 'text-embedding-3-large',
          },
          keyword_setting: {
            keyword_weight: 0.2,
          },
        },
        top_k: 3,
        score_threshold_enabled: false,
        score_threshold: 0.5,
      },
    }))

    act(() => {
      result.current.handleEmbeddingModelChange({
        embeddingModel: 'text-embedding-3-small',
        embeddingModelProvider: 'openai',
      })
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        embedding_model: 'text-embedding-3-small',
        embedding_model_provider: 'openai',
        retrieval_model: expect.objectContaining({
          weights: expect.objectContaining({
            vector_setting: expect.objectContaining({
              embedding_provider_name: 'openai',
              embedding_model_name: 'text-embedding-3-small',
            }),
          }),
        }),
      }),
    })

    act(() => {
      result.current.handleRetrievalSearchMethodChange(RetrievalSearchMethodEnum.hybrid)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          search_method: RetrievalSearchMethodEnum.hybrid,
          reranking_mode: RerankingModeEnum.RerankingModel,
          reranking_enable: true,
        }),
      }),
    })
  })

  it('should seed hybrid weights and propagate retrieval tuning updates', () => {
    const { result } = renderConfigHook(createNodeData({
      retrieval_model: {
        search_method: RetrievalSearchMethodEnum.hybrid,
        reranking_enable: false,
        top_k: 3,
        score_threshold_enabled: false,
        score_threshold: 0.5,
      },
    }))

    act(() => {
      result.current.handleHybridSearchModeChange(HybridSearchModeEnum.WeightedScore)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          reranking_mode: HybridSearchModeEnum.WeightedScore,
          reranking_enable: false,
          weights: expect.objectContaining({
            vector_setting: expect.objectContaining({
              embedding_provider_name: 'openai',
              embedding_model_name: 'text-embedding-3-large',
            }),
          }),
        }),
      }),
    })

    act(() => {
      result.current.handleRerankingModelEnabledChange(true)
      result.current.handleWeighedScoreChange({ value: [0.6, 0.4] })
      result.current.handleRerankingModelChange({
        reranking_provider_name: 'cohere',
        reranking_model_name: 'rerank-v3',
      })
      result.current.handleTopKChange(8)
      result.current.handleScoreThresholdChange(0.75)
      result.current.handleScoreThresholdEnabledChange(true)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(2, {
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          reranking_enable: true,
        }),
      }),
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(3, {
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          weights: expect.objectContaining({
            weight_type: WeightedScoreEnum.Customized,
            vector_setting: expect.objectContaining({
              vector_weight: 0.6,
            }),
            keyword_setting: expect.objectContaining({
              keyword_weight: 0.4,
            }),
          }),
        }),
      }),
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(4, {
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          reranking_model: {
            reranking_provider_name: 'cohere',
            reranking_model_name: 'rerank-v3',
          },
        }),
      }),
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(5, {
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          top_k: 8,
        }),
      }),
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(6, {
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          score_threshold: 0.75,
        }),
      }),
    })
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenNthCalledWith(7, {
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          score_threshold_enabled: true,
        }),
      }),
    })
  })

  it('should reuse existing hybrid weights and allow empty embedding defaults', () => {
    const { result } = renderConfigHook(createNodeData({
      embedding_model: undefined,
      embedding_model_provider: undefined,
      retrieval_model: {
        search_method: RetrievalSearchMethodEnum.hybrid,
        reranking_enable: false,
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.9,
            embedding_provider_name: 'existing-provider',
            embedding_model_name: 'existing-model',
          },
          keyword_setting: {
            keyword_weight: 0.1,
          },
        },
        top_k: 3,
        score_threshold_enabled: false,
        score_threshold: 0.5,
      },
    }))

    act(() => {
      result.current.handleHybridSearchModeChange(HybridSearchModeEnum.RerankingModel)
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        retrieval_model: expect.objectContaining({
          reranking_mode: HybridSearchModeEnum.RerankingModel,
          reranking_enable: true,
          weights: expect.objectContaining({
            vector_setting: expect.objectContaining({
              embedding_provider_name: 'existing-provider',
              embedding_model_name: 'existing-model',
            }),
          }),
        }),
      }),
    })

    act(() => {
      result.current.handleEmbeddingModelChange({
        embeddingModel: 'fallback-model',
        embeddingModelProvider: '',
      })
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: expect.objectContaining({
        embedding_model: 'fallback-model',
        embedding_model_provider: '',
        retrieval_model: expect.objectContaining({
          weights: expect.objectContaining({
            vector_setting: expect.objectContaining({
              embedding_provider_name: '',
              embedding_model_name: 'fallback-model',
            }),
          }),
        }),
      }),
    })
  })

  it('should normalize input variables and merge summary index settings', () => {
    const { result } = renderConfigHook(createNodeData())

    act(() => {
      result.current.handleInputVariableChange('chunks')
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: {
        index_chunk_variable_selector: [],
      },
    })

    act(() => {
      result.current.handleInputVariableChange(['payload', 'chunks'])
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: {
        index_chunk_variable_selector: ['payload', 'chunks'],
      },
    })

    act(() => {
      result.current.handleSummaryIndexSettingChange({
        enable: true,
      })
    })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenLastCalledWith({
      id: 'knowledge-base-node',
      data: {
        summary_index_setting: {
          enable: true,
          summary_prompt: 'existing prompt',
        },
      },
    })
  })
})
