import type { MutableRefObject } from 'react'
import type { KnowledgeRetrievalNodeType } from '../../types'
import type { DataSet } from '@/models/datasets'
import { act, renderHook, waitFor } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { DATASET_DEFAULT } from '@/config'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { AppModeEnum, RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import useKnowledgeModelConfig from '../use-knowledge-model-config'

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'dataset-1',
  name: 'Dataset Name',
  indexing_status: 'completed',
  icon_info: {
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_type: 'emoji',
    icon_url: '',
  },
  description: 'Dataset description',
  permission: DatasetPermission.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique: 'high_quality' as DataSet['indexing_technique'],
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1690000000,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 1,
  total_document_count: 1,
  word_count: 1000,
  provider: 'internal',
  embedding_model: 'text-embedding-3',
  embedding_model_provider: 'openai',
  embedding_available: true,
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: {
    top_k: 0,
    score_threshold: 0,
    score_threshold_enabled: false,
  },
  built_in_field_enabled: false,
  runtime_mode: 'rag_pipeline',
  enable_api: false,
  is_multimodal: false,
  ...overrides,
})

const createPayload = (overrides: Partial<KnowledgeRetrievalNodeType> = {}): KnowledgeRetrievalNodeType => ({
  title: 'Knowledge Retrieval',
  desc: '',
  type: BlockEnum.KnowledgeRetrieval,
  query_variable_selector: [],
  query_attachment_selector: ['start-node', 'files'],
  dataset_ids: ['dataset-1'],
  retrieval_mode: RETRIEVE_TYPE.multiWay,
  multiple_retrieval_config: undefined,
  single_retrieval_config: {
    model: {
      provider: '',
      name: '',
      mode: '',
      completion_params: {},
    },
  },
  metadata_filtering_mode: undefined,
  metadata_filtering_conditions: undefined,
  metadata_model_config: undefined,
  ...overrides,
})

const createState = (initialInputs: KnowledgeRetrievalNodeType) => {
  const inputRef = { current: initialInputs } as MutableRefObject<KnowledgeRetrievalNodeType>
  const setInputs = vi.fn((nextInputs: KnowledgeRetrievalNodeType) => {
    inputRef.current = nextInputs
  })

  return { inputRef, setInputs }
}

describe('use-knowledge-model-config', () => {
  const selectedDatasets = [createDataset()]
  const fallbackRerankModel = {
    provider: 'rerank-provider',
    model: 'rerank-model',
  }

  it('creates missing single retrieval config when the model or completion params change', async () => {
    const { inputRef, setInputs } = createState(createPayload({
      retrieval_mode: RETRIEVE_TYPE.multiWay,
      single_retrieval_config: undefined,
      multiple_retrieval_config: undefined,
    }))

    const { result } = renderHook(() => useKnowledgeModelConfig({
      inputs: inputRef.current,
      inputRef,
      setInputs,
      selectedDatasets,
      currentProvider: undefined,
      currentModel: undefined,
      fallbackRerankModel: {},
      hasRerankDefaultModel: false,
    }))

    await waitFor(() => {
      expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
        multiple_retrieval_config: expect.objectContaining({
          top_k: DATASET_DEFAULT.top_k,
          reranking_enable: false,
        }),
      }))
    })

    setInputs.mockClear()

    act(() => {
      inputRef.current = createPayload({
        retrieval_mode: RETRIEVE_TYPE.oneWay,
        single_retrieval_config: undefined,
      })
      result.current.handleModelChanged({
        provider: 'anthropic',
        modelId: 'claude-sonnet',
      })
    })

    expect(setInputs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      single_retrieval_config: {
        model: {
          provider: 'anthropic',
          name: 'claude-sonnet',
          mode: AppModeEnum.CHAT,
          completion_params: {},
        },
      },
    }))

    setInputs.mockClear()

    act(() => {
      inputRef.current = createPayload({
        retrieval_mode: RETRIEVE_TYPE.oneWay,
        single_retrieval_config: undefined,
      })
      result.current.handleCompletionParamsChange({ temperature: 0.2 })
      result.current.handleCompletionParamsChange({ temperature: 0.2 })
    })

    expect(setInputs).toHaveBeenCalledTimes(1)
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      single_retrieval_config: {
        model: {
          provider: '',
          name: '',
          mode: '',
          completion_params: { temperature: 0.2 },
        },
      },
    }))
  })

  it('hydrates defaults, respects initialized rerank state, and updates retrieval config changes', async () => {
    const { inputRef, setInputs } = createState(createPayload({
      retrieval_mode: RETRIEVE_TYPE.oneWay,
      single_retrieval_config: undefined,
      multiple_retrieval_config: undefined,
    }))

    const { result } = renderHook(() => useKnowledgeModelConfig({
      inputs: inputRef.current,
      inputRef,
      setInputs,
      selectedDatasets,
      currentProvider: { provider: 'openai' },
      currentModel: {
        model: 'gpt-4o-mini',
        model_properties: {
          mode: AppModeEnum.CHAT,
        },
      },
      fallbackRerankModel,
      hasRerankDefaultModel: true,
    }))

    await waitFor(() => {
      expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
        single_retrieval_config: {
          model: {
            provider: 'openai',
            name: 'gpt-4o-mini',
            mode: AppModeEnum.CHAT,
            completion_params: {},
          },
        },
        multiple_retrieval_config: expect.objectContaining({
          top_k: DATASET_DEFAULT.top_k,
          reranking_enable: true,
        }),
      }))
    })

    setInputs.mockClear()

    act(() => {
      result.current.handleRetrievalModeChange(RETRIEVE_TYPE.multiWay)
    })

    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      retrieval_mode: RETRIEVE_TYPE.multiWay,
      multiple_retrieval_config: expect.objectContaining({
        top_k: DATASET_DEFAULT.top_k,
        reranking_enable: true,
        reranking_model: {
          provider: 'rerank-provider',
          model: 'rerank-model',
        },
      }),
    }))

    setInputs.mockClear()

    act(() => {
      result.current.handleMultipleRetrievalConfigChange({
        top_k: 8,
        score_threshold: 0.4,
      })
    })

    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      multiple_retrieval_config: expect.objectContaining({
        top_k: 8,
        score_threshold: 0.4,
        reranking_enable: true,
      }),
    }))

    setInputs.mockClear()

    act(() => {
      inputRef.current = createPayload({
        retrieval_mode: RETRIEVE_TYPE.multiWay,
        single_retrieval_config: undefined,
        multiple_retrieval_config: {
          top_k: 5,
          score_threshold: 0.2,
        },
      })
      result.current.handleRetrievalModeChange(RETRIEVE_TYPE.oneWay)
    })

    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      retrieval_mode: RETRIEVE_TYPE.oneWay,
      single_retrieval_config: {
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: AppModeEnum.CHAT,
          completion_params: {},
        },
      },
    }))

    const configuredState = createState(createPayload({
      retrieval_mode: RETRIEVE_TYPE.oneWay,
      single_retrieval_config: {
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: AppModeEnum.CHAT,
          completion_params: {},
        },
      },
      multiple_retrieval_config: {
        top_k: 6,
        score_threshold: 0.1,
        reranking_enable: true,
        reranking_model: {
          provider: 'rerank-provider',
          model: 'rerank-model',
        },
      },
    }))

    renderHook(() => useKnowledgeModelConfig({
      inputs: configuredState.inputRef.current,
      inputRef: configuredState.inputRef,
      setInputs: configuredState.setInputs,
      selectedDatasets,
      currentProvider: { provider: 'openai' },
      currentModel: {
        model: 'gpt-4o-mini',
        model_properties: {
          mode: AppModeEnum.CHAT,
        },
      },
      fallbackRerankModel,
      hasRerankDefaultModel: true,
    }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(configuredState.setInputs).toHaveBeenCalledTimes(0)
  })
})
