import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeRetrievalNodeType } from '../../types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { DATASET_DEFAULT } from '@/config'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import useKnowledgeModelConfig from '../use-knowledge-model-config'

const createDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => ({
  ...createDatasetFixture(),
  id: 'dataset-1',
  name: 'Dataset Name',
  icon_info: {
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_type: 'emoji',
    icon_url: '',
  },
  description: 'Dataset description',
  permission: PermissionLevel.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique:
    'high_quality' as DatasetDetailWithPartialMembersResponse['indexing_technique'],
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1690000000,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 1,
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

const createPayload = (
  overrides: Partial<KnowledgeRetrievalNodeType> = {},
): KnowledgeRetrievalNodeType => ({
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

type Options = Partial<
  Pick<
    Parameters<typeof useKnowledgeModelConfig>[0],
    'currentProvider' | 'currentModel' | 'fallbackRerankModel' | 'hasRerankDefaultModel'
  >
>
const selectedDatasets = [createDataset()]
const fallbackRerankModel = { provider: 'rerank-provider', model: 'rerank-model' }
const modelDefaults: Options = {
  currentProvider: { provider: 'openai' },
  currentModel: { model: 'gpt-4o-mini', model_properties: { mode: 'chat' } },
  fallbackRerankModel,
  hasRerankDefaultModel: true,
}
const renderConfig = (initialInputs: KnowledgeRetrievalNodeType, options: Options = {}) => {
  const config = { fallbackRerankModel: {}, hasRerankDefaultModel: false, ...options }
  return renderHook(() => {
    const [inputs, setInputs] = useState(initialInputs)
    const inputRef = useRef(inputs)
    inputRef.current = inputs
    const actions = useKnowledgeModelConfig({
      inputs,
      inputRef,
      setInputs,
      selectedDatasets,
      ...config,
    })
    return { inputs, ...actions }
  })
}

describe('useKnowledgeModelConfig', () => {
  it('initializes missing model and retrieval defaults from available providers', async () => {
    const { result } = renderConfig(
      createPayload({
        retrieval_mode: RETRIEVE_TYPE.oneWay,
        single_retrieval_config: undefined,
      }),
      modelDefaults,
    )
    await waitFor(() =>
      expect(result.current.inputs.single_retrieval_config).toEqual({
        model: { provider: 'openai', name: 'gpt-4o-mini', mode: 'chat', completion_params: {} },
      }),
    )
    expect(result.current.inputs.multiple_retrieval_config).toMatchObject({
      top_k: DATASET_DEFAULT.top_k,
      reranking_enable: true,
    })
  })

  it('creates a missing single retrieval model on selection and preserves completion parameters', () => {
    const { result } = renderConfig(createPayload({ single_retrieval_config: undefined }))
    expect(result.current.inputs.multiple_retrieval_config).toMatchObject({
      top_k: DATASET_DEFAULT.top_k,
      reranking_enable: false,
    })
    act(() => result.current.handleCompletionParamsChange({ temperature: 0.2 }))
    const inputs = result.current.inputs
    act(() => result.current.handleCompletionParamsChange({ temperature: 0.2 }))
    expect(result.current.inputs).toBe(inputs)
    act(() =>
      result.current.handleModelChanged({ provider: 'anthropic', modelId: 'claude-sonnet' }),
    )
    expect(result.current.inputs.single_retrieval_config).toEqual({
      model: {
        provider: 'anthropic',
        name: 'claude-sonnet',
        mode: 'chat',
        completion_params: { temperature: 0.2 },
      },
    })
  })

  it('initializes an empty single-retrieval model when selected before editing parameters', () => {
    const { result } = renderConfig(createPayload({ single_retrieval_config: undefined }))
    act(() =>
      result.current.handleModelChanged({
        provider: 'openai',
        modelId: 'completion-model',
        mode: 'completion',
      }),
    )
    expect(result.current.inputs.single_retrieval_config).toEqual({
      model: {
        provider: 'openai',
        name: 'completion-model',
        mode: 'completion',
        completion_params: {},
      },
    })
  })

  it('retains edits while switching retrieval modes and applies reranker defaults', () => {
    const { result } = renderConfig(
      createPayload({ retrieval_mode: RETRIEVE_TYPE.oneWay }),
      modelDefaults,
    )
    act(() => result.current.handleRetrievalModeChange(RETRIEVE_TYPE.multiWay))
    expect(result.current.inputs.multiple_retrieval_config).toMatchObject({
      top_k: DATASET_DEFAULT.top_k,
      reranking_enable: true,
      reranking_model: fallbackRerankModel,
    })
    act(() =>
      result.current.handleMultipleRetrievalConfigChange({ top_k: 8, score_threshold: 0.4 }),
    )
    expect(result.current.inputs.multiple_retrieval_config).toMatchObject({
      top_k: 8,
      score_threshold: 0.4,
      reranking_enable: true,
    })
    act(() => result.current.handleRetrievalModeChange(RETRIEVE_TYPE.oneWay))
    expect(result.current.inputs.retrieval_mode).toBe(RETRIEVE_TYPE.oneWay)
    expect(result.current.inputs.single_retrieval_config?.model.name).toBe('gpt-4o-mini')
    expect(result.current.inputs.multiple_retrieval_config?.top_k).toBe(8)
  })

  it.each([RETRIEVE_TYPE.oneWay, RETRIEVE_TYPE.multiWay])(
    'preserves configured %s settings when defaults are available',
    (mode) => {
      const inputs = createPayload({
        retrieval_mode: mode,
        single_retrieval_config: {
          model: {
            provider: 'custom-provider',
            name: 'chosen-model',
            mode: 'chat',
            completion_params: { temperature: 0.8 },
          },
        },
        multiple_retrieval_config: {
          top_k: 6,
          score_threshold: 0.1,
          reranking_enable: false,
          reranking_model: { provider: 'chosen-reranker', model: 'chosen-model' },
        },
      })
      const { result } = renderConfig(inputs, modelDefaults)
      expect(result.current.inputs).toBe(inputs)
    },
  )
})
