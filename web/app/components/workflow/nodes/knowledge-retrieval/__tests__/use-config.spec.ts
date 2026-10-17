import type {
  DatasetDetailWithPartialMembersResponse,
  DatasetDocMetadataResponse,
  DatasetListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeRetrievalNodeType } from '../types'
import { act, waitFor } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useCurrentProviderAndModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useDatasetsDetailStore } from '@/app/components/workflow/datasets-detail-store/store'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { DATASET_DEFAULT } from '@/config'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { fetchDatasets } from '@/service/datasets'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import { useNodesReadOnly, useWorkflow } from '../../../hooks/use-workflow'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '../types'
import useConfig from '../use-config'
const renderConfig = (
  data: KnowledgeRetrievalNodeType,
  options: Parameters<typeof renderNodeConfig>[2],
) => {
  const rendered = renderNodeConfig(useConfig, data, { ...options, nodeId: 'knowledge-node' })
  return {
    ...rendered,
    result: {
      get current() {
        return rendered.result.current.config
      },
    },
  }
}
let uuidCounter = 0

vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    uuidCounter += 1
    return `condition-${uuidCounter}`
  }),
}))

vi.mock('../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-workflow')>()

  return {
    ...actual,
    useNodesReadOnly: vi.fn(),

    useWorkflow: vi.fn(),
  }
})

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(),
  useCurrentProviderAndModel: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/datasets-detail-store/store', () => ({
  useDatasetsDetailStore: vi.fn(),
}))

vi.mock('@/service/datasets', () => ({
  fetchDatasets: vi.fn(),
}))

type DatasetListItem = DatasetListResponse['data'][number]

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
let chatflowMode = false
const mockUseWorkflow = vi.mocked(useWorkflow)
const mockUseModelListAndDefaultModelAndCurrentProviderAndModel = vi.mocked(
  useModelListAndDefaultModelAndCurrentProviderAndModel,
)
const mockUseCurrentProviderAndModel = vi.mocked(useCurrentProviderAndModel)
const mockUseAvailableVarList = vi.mocked(useAvailableVarList)
const mockUseDatasetsDetailStore = vi.mocked(useDatasetsDetailStore)
const mockFetchDatasets = vi.mocked(fetchDatasets)

const createDataset = (overrides: Partial<DatasetListItem> = {}): DatasetListItem => ({
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

const createMetadata = (
  overrides: Partial<DatasetDocMetadataResponse> = {},
): DatasetDocMetadataResponse => ({
  id: 'meta-1',
  name: 'topic',
  type: MetadataFilteringVariableType.string,
  ...overrides,
})

const createData = (
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
  metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
  metadata_filtering_conditions: undefined,
  metadata_model_config: undefined,
  ...overrides,
})

describe('knowledge-retrieval/use-config', () => {
  const updateDatasetsDetail = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    uuidCounter = 0

    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    chatflowMode = true
    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranch: () => [
        {
          id: 'start-node',
          data: {
            type: BlockEnum.Start,
          },
        },
      ],
    } as unknown as ReturnType<typeof useWorkflow>)
    const createModelCatalog = (type: ModelTypeEnum) => {
      if (type === 'rerank') {
        return {
          modelList: [
            {
              provider: 'rerank-provider',
              models: [
                {
                  model: 'rerank-model',
                },
              ],
            },
          ],
          defaultModel: {
            provider: {
              provider: 'rerank-provider',
            },
            model: 'rerank-model',
          },
          currentProvider: { provider: 'rerank-provider' },
          currentModel: {
            model: 'rerank-model',
            model_properties: {
              mode: 'chat' as const,
            },
          },
        } as unknown as ReturnType<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>
      }

      return {
        modelList: [],
        defaultModel: undefined,
        currentProvider: { provider: 'openai' },
        currentModel: {
          model: 'gpt-4o-mini',
          model_properties: {
            mode: 'chat' as const,
          },
        },
      } as unknown as ReturnType<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>
    }
    const textModels = createModelCatalog(ModelTypeEnum.textGeneration)
    const rerankModels = createModelCatalog(ModelTypeEnum.rerank)
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel.mockImplementation((type) =>
      type === ModelTypeEnum.rerank ? rerankModels : textModels,
    )
    mockUseCurrentProviderAndModel.mockReturnValue({
      currentProvider: { provider: 'rerank-provider' },
      currentModel: { model: 'rerank-model' },
    } as unknown as ReturnType<typeof useCurrentProviderAndModel>)
    mockUseAvailableVarList.mockImplementation((_id, config) => {
      const activeConfig = config!
      const stringVars = [
        {
          nodeId: 'string-node',
          title: 'String Node',
          vars: [
            {
              variable: 'topic',
              type: VarType.string,
            },
          ],
        },
      ]
      const numberVars = [
        {
          nodeId: 'number-node',
          title: 'Number Node',
          vars: [
            {
              variable: 'score',
              type: VarType.number,
            },
          ],
        },
      ]

      if (activeConfig.filterVar({ type: VarType.string } as never, ['string-node', 'topic'])) {
        return {
          availableVars: stringVars,
          availableNodes: [],
          availableNodesWithParent: [],
        } as unknown as ReturnType<typeof useAvailableVarList>
      }

      return {
        availableVars: numberVars,
        availableNodes: [],
        availableNodesWithParent: [],
      } as unknown as ReturnType<typeof useAvailableVarList>
    })
    mockUseDatasetsDetailStore.mockImplementation((selector) => {
      return selector({ updateDatasetsDetail } as never)
    })
    mockFetchDatasets.mockResolvedValue({
      data: [createDataset({ id: 'dataset-1', name: 'Knowledge Base', is_multimodal: true })],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    })
  })

  it('initializes defaults, loads dataset details, and exposes metadata variables', async () => {
    const { result } = renderConfig(createData(), {
      resource: { kind: 'app', appId: 'app-1', mode: chatflowMode ? 'advanced-chat' : 'workflow' },
    })

    await waitFor(() => {
      expect(result.current.selectedDatasetsLoaded).toBe(true)
      expect(result.current.selectedDatasets[0]?.name).toBe('Knowledge Base')
    })

    expect(mockFetchDatasets).toHaveBeenCalledWith({
      params: {
        page: 1,
        ids: ['dataset-1'],
      },
    })
    expect(result.current.inputs.query_variable_selector).toEqual(['start-node', 'sys.query'])
    expect(result.current.inputs.multiple_retrieval_config).toEqual(
      expect.objectContaining({
        top_k: DATASET_DEFAULT.top_k,
        reranking_enable: true,
      }),
    )
    expect(result.current.showImageQueryVarSelector).toBe(true)
    expect(result.current.availableStringVars).toEqual([
      {
        nodeId: 'string-node',
        title: 'String Node',
        vars: [
          {
            variable: 'topic',
            type: VarType.string,
          },
        ],
      },
    ])
    expect(result.current.availableNumberVars).toEqual([
      {
        nodeId: 'number-node',
        title: 'Number Node',
        vars: [
          {
            variable: 'score',
            type: VarType.number,
          },
        ],
      },
    ])
  })

  it('keeps edits made while the initial dataset details request is pending', async () => {
    const details = createDeferred<Awaited<ReturnType<typeof fetchDatasets>>>()
    mockFetchDatasets.mockReturnValueOnce(details.promise)
    const { result } = renderConfig(createData(), {
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    })
    expect(result.current.selectedDatasetsLoaded).toBe(false)
    act(() => result.current.handleQueryVarChange(['start-node', 'edited-query']))
    act(() => result.current.handleQueryAttachmentChange(['start-node', 'edited-files']))
    await act(async () => {
      details.resolve({ data: [createDataset()], page: 1, limit: 20, total: 1, has_more: false })
      await details.promise
    })
    await waitFor(() => expect(result.current.selectedDatasetsLoaded).toBe(true))
    expect(result.current.inputs).toMatchObject({
      query_variable_selector: ['start-node', 'edited-query'],
      query_attachment_selector: ['start-node', 'edited-files'],
      multiple_retrieval_config: { top_k: DATASET_DEFAULT.top_k, reranking_enable: true },
    })
  })

  it('updates query and single retrieval model state through the real hook', async () => {
    const { result } = renderConfig(createData(), {
      resource: { kind: 'app', appId: 'app-1', mode: chatflowMode ? 'advanced-chat' : 'workflow' },
    })

    await waitFor(() => {
      expect(result.current.selectedDatasetsLoaded).toBe(true)
    })

    act(() => {
      result.current.handleQueryVarChange(['start-node', 'question'])
    })
    act(() => {
      result.current.handleQueryAttachmentChange(['start-node', 'files'])
    })
    act(() => {
      result.current.handleRetrievalModeChange(RETRIEVE_TYPE.oneWay)
    })
    act(() => {
      result.current.handleModelChanged({
        provider: 'anthropic',
        modelId: 'claude-sonnet',
        mode: 'chat' as const,
      })
    })
    act(() => {
      result.current.handleCompletionParamsChange({ temperature: 0.2 })
    })
    act(() => {
      result.current.handleCompletionParamsChange({ temperature: 0.2 })
    })

    expect(result.current.inputs).toEqual(
      expect.objectContaining({
        query_variable_selector: ['start-node', 'question'],
      }),
    )
    expect(result.current.inputs).toEqual(
      expect.objectContaining({
        query_attachment_selector: ['start-node', 'files'],
      }),
    )

    await waitFor(() => {
      expect(result.current.inputs.retrieval_mode).toBe(RETRIEVE_TYPE.oneWay)
      expect(result.current.inputs.single_retrieval_config).toEqual(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'anthropic',
            name: 'claude-sonnet',
            completion_params: { temperature: 0.2 },
          }),
        }),
      )
    })
  })

  it('updates retrieval config and dataset state through the real hook', async () => {
    const { result } = renderConfig(createData(), {
      resource: { kind: 'app', appId: 'app-1', mode: chatflowMode ? 'advanced-chat' : 'workflow' },
    })

    await waitFor(() => {
      expect(result.current.selectedDatasetsLoaded).toBe(true)
    })

    act(() => {
      result.current.handleRetrievalModeChange(RETRIEVE_TYPE.oneWay)
    })
    act(() => {
      result.current.handleRetrievalModeChange(RETRIEVE_TYPE.multiWay)
    })
    act(() => {
      result.current.handleMultipleRetrievalConfigChange({ top_k: 8, score_threshold: 0.4 })
    })
    act(() => {
      result.current.handleOnDatasetsChange([
        createDataset({
          id: 'dataset-2',
          name: 'Economic',
          indexing_technique:
            'economy' as DatasetDetailWithPartialMembersResponse['indexing_technique'],
          is_multimodal: false,
        }),
        createDataset({
          id: 'dataset-3',
          name: 'High Quality',
          indexing_technique:
            'high_quality' as DatasetDetailWithPartialMembersResponse['indexing_technique'],
          is_multimodal: false,
        }),
      ])
    })

    expect(result.current.inputs).toEqual(
      expect.objectContaining({
        multiple_retrieval_config: expect.objectContaining({
          top_k: 8,
          score_threshold: 0.4,
        }),
      }),
    )

    await waitFor(() => {
      expect(result.current.inputs.retrieval_mode).toBe(RETRIEVE_TYPE.multiWay)
      expect(result.current.inputs.query_attachment_selector).toEqual([])
      expect(result.current.inputs.dataset_ids).toEqual(['dataset-2', 'dataset-3'])
      expect(result.current.inputs.multiple_retrieval_config).toEqual(
        expect.objectContaining({
          reranking_enable: true,
          reranking_model: {
            provider: 'rerank-provider',
            model: 'rerank-model',
          },
        }),
      )
      expect(result.current.rerankModelOpen).toBe(true)
    })

    expect(updateDatasetsDetail).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'dataset-2' }),
      expect.objectContaining({ id: 'dataset-3' }),
    ])
  })

  it('manages metadata conditions, metadata model config, and variable filters', async () => {
    const { result } = renderConfig(
      createData({
        dataset_ids: [],
      }),
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
      },
    )

    await waitFor(() => {
      expect(result.current.selectedDatasetsLoaded).toBe(true)
    })

    act(() => {
      result.current.handleMetadataFilterModeChange(MetadataFilteringModeEnum.manual)
    })
    act(() => {
      result.current.handleAddCondition(createMetadata())
    })
    act(() => {
      result.current.handleAddCondition(
        createMetadata({
          id: 'meta-2',
          name: 'score',
          type: MetadataFilteringVariableType.number,
        }),
      )
    })

    await waitFor(() => {
      expect(result.current.inputs.metadata_filtering_mode).toBe(MetadataFilteringModeEnum.manual)
      expect(result.current.inputs.metadata_filtering_conditions?.conditions).toHaveLength(2)
    })

    const firstCondition = result.current.inputs.metadata_filtering_conditions!.conditions[0]!

    act(() => {
      result.current.handleUpdateCondition(firstCondition!.id, {
        ...firstCondition,
        value: 'agent',
        comparison_operator: ComparisonOperator.contains,
      })
    })
    act(() => {
      result.current.handleToggleConditionLogicalOperator()
    })
    act(() => {
      result.current.handleRemoveCondition(firstCondition!.id)
    })
    act(() => {
      result.current.handleMetadataModelChange({
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
        mode: 'chat' as const,
      })
    })
    act(() => {
      result.current.handleMetadataCompletionParamsChange({ top_p: 0.3 })
    })

    await waitFor(() => {
      expect(result.current.inputs.metadata_filtering_conditions?.logical_operator).toBe(
        LogicalOperator.or,
      )
      expect(result.current.inputs.metadata_filtering_conditions?.conditions).toHaveLength(1)
      expect(result.current.inputs.metadata_model_config).toEqual({
        provider: 'openai',
        name: 'gpt-4.1-mini',
        mode: 'chat' as const,
        completion_params: { top_p: 0.3 },
      })
    })

    expect(result.current.filterStringVar({ type: VarType.string } as never)).toBe(true)
    expect(result.current.filterStringVar({ type: VarType.number } as never)).toBe(false)
    expect(result.current.filterFileVar({ type: VarType.file } as never)).toBe(true)
    expect(result.current.filterFileVar({ type: VarType.arrayFile } as never)).toBe(true)
    expect(result.current.filterFileVar({ type: VarType.string } as never)).toBe(false)
  })
})
