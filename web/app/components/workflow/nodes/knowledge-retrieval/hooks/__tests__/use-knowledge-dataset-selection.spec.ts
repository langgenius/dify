import type { MutableRefObject } from 'react'
import type { KnowledgeRetrievalNodeType } from '../../types'
import type { DataSet } from '@/models/datasets'
import { act, renderHook, waitFor } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import useKnowledgeDatasetSelection from '../use-knowledge-dataset-selection'

vi.mock('@/service/datasets', () => ({
  fetchDatasets: vi.fn(),
}))

const mockFetchDatasets = vi.mocked(fetchDatasets)

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
  multiple_retrieval_config: {
    top_k: 5,
    score_threshold: 0.2,
  },
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

describe('use-knowledge-dataset-selection', () => {
  const updateDatasetsDetail = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchDatasets.mockResolvedValue({
      data: [createDataset({ id: 'dataset-1', name: 'Knowledge Base', is_multimodal: true })],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    })
  })

  it('loads dataset details on mount and exposes multimodal state', async () => {
    const { inputRef, setInputs } = createState(createPayload())

    const { result } = renderHook(() => useKnowledgeDatasetSelection({
      inputs: inputRef.current,
      inputRef,
      setInputs,
      payloadRetrievalMode: RETRIEVE_TYPE.multiWay,
      updateDatasetsDetail,
      fallbackRerankModel: {
        provider: 'rerank-provider',
        model: 'rerank-model',
      },
    }))

    await waitFor(() => {
      expect(result.current.selectedDatasetsLoaded).toBe(true)
      expect(result.current.selectedDatasets).toEqual([
        expect.objectContaining({
          id: 'dataset-1',
          name: 'Knowledge Base',
        }),
      ])
    })

    expect(mockFetchDatasets).toHaveBeenCalledWith({
      url: '/datasets',
      params: {
        page: 1,
        ids: ['dataset-1'],
      },
    })
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      dataset_ids: ['dataset-1'],
    }))
    expect(result.current.showImageQueryVarSelector).toBe(true)
  })

  it('updates dataset ids, retrieval config, attachment selector, and rerank modal state', async () => {
    const { inputRef, setInputs } = createState(createPayload({
      dataset_ids: [],
    }))

    const { result } = renderHook(() => useKnowledgeDatasetSelection({
      inputs: inputRef.current,
      inputRef,
      setInputs,
      payloadRetrievalMode: RETRIEVE_TYPE.multiWay,
      updateDatasetsDetail,
      fallbackRerankModel: {
        provider: 'rerank-provider',
        model: 'rerank-model',
      },
    }))

    await waitFor(() => {
      expect(result.current.selectedDatasetsLoaded).toBe(true)
    })

    const nextDatasets = [
      createDataset({
        id: 'dataset-2',
        name: 'Economic Internal',
        indexing_technique: 'economy' as DataSet['indexing_technique'],
        provider: 'internal',
      }),
      createDataset({
        id: 'dataset-3',
        name: 'High Quality Internal',
        indexing_technique: 'high_quality' as DataSet['indexing_technique'],
        provider: 'internal',
      }),
    ]

    act(() => {
      result.current.handleOnDatasetsChange(nextDatasets)
    })

    expect(updateDatasetsDetail).toHaveBeenCalledWith(nextDatasets)
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      dataset_ids: ['dataset-2', 'dataset-3'],
      query_attachment_selector: [],
      multiple_retrieval_config: expect.objectContaining({
        reranking_enable: true,
        reranking_model: {
          provider: 'rerank-provider',
          model: 'rerank-model',
        },
      }),
    }))
    expect(result.current.rerankModelOpen).toBe(true)
    expect(result.current.showImageQueryVarSelector).toBe(false)
  })

  it('keeps attachment selectors and skips multiple retrieval updates outside the multi-way flow', async () => {
    const { inputRef, setInputs } = createState(createPayload({
      dataset_ids: [],
      retrieval_mode: RETRIEVE_TYPE.oneWay,
      query_attachment_selector: ['start-node', 'files'],
      multiple_retrieval_config: {
        top_k: 5,
        score_threshold: 0.2,
      },
    }))

    const { result } = renderHook(() => useKnowledgeDatasetSelection({
      inputs: inputRef.current,
      inputRef,
      setInputs,
      payloadRetrievalMode: RETRIEVE_TYPE.oneWay,
      updateDatasetsDetail,
      fallbackRerankModel: {},
    }))

    await waitFor(() => {
      expect(result.current.selectedDatasetsLoaded).toBe(true)
    })

    const multimodalDataset = createDataset({
      id: 'dataset-4',
      is_multimodal: true,
    })

    act(() => {
      result.current.handleOnDatasetsChange([multimodalDataset])
      result.current.setRerankModelOpen(false)
    })

    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      dataset_ids: ['dataset-4'],
      query_attachment_selector: ['start-node', 'files'],
      multiple_retrieval_config: {
        top_k: 5,
        score_threshold: 0.2,
      },
    }))
    expect(result.current.rerankModelOpen).toBe(false)
    expect(result.current.showImageQueryVarSelector).toBe(true)
  })
})
