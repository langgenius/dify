import type { TFunction } from 'i18next'
import type { VisionSettings } from '@/types/app'
import { zAppModelConfigPayload } from '@dify/contracts/api/console/apps/zod.gen'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { withSelectorKey } from '@/test/i18n-mock'
import {
  AgentStrategy,
  AppModeEnum,
  ModelModeType,
  Resolution,
  RETRIEVE_TYPE,
  TransferMethod,
} from '@/types/app'
import { buildConfigurationFeaturesData } from '../../utils'
import {
  buildConfigurationDatasetConfigs,
  createDatasetSelectHandler,
} from '../configuration-lifecycle/dataset'
import { loadConfigurationState } from '../configuration-lifecycle/load'
import { createModelChangeHandler } from '../configuration-lifecycle/model'
import { buildPublishBody, createPublishHandler } from '../configuration-lifecycle/publish'
import { buildPublishedConfig } from '../configuration-lifecycle/published-config'

const mockFetchAppDetailDirect = vi.fn()
const mockFetchDatasets = vi.fn()
const mockFetchCollectionList = vi.fn()
const mockFetchAndMergeValidCompletionParams = vi.fn()
const mockGetSelectedDatasetsMode = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastWarning = vi.fn()
const t = withSelectorKey((key: string) => key) as TFunction<
  ['appDebug', 'common', 'modelProvider']
>

const baseVisionConfig: VisionSettings = {
  enabled: false,
  number_limits: 1,
  detail: Resolution.high,
  transfer_methods: [TransferMethod.remote_url],
}

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: { byAppId: { get: (...args: unknown[]) => mockFetchAppDetailDirect(...args) } },
  },
}))

vi.mock('@/service/datasets', () => ({
  fetchDatasets: (...args: unknown[]) => mockFetchDatasets(...args),
}))

vi.mock('@/service/tools', () => ({
  fetchCollectionList: (...args: unknown[]) => mockFetchCollectionList(...args),
}))

vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: (...args: unknown[]) =>
    mockFetchAndMergeValidCompletionParams(...args),
}))

vi.mock('@/app/components/workflow/nodes/knowledge-retrieval/utils', async () => {
  const actual = await vi.importActual<any>(
    '@/app/components/workflow/nodes/knowledge-retrieval/utils',
  )

  return {
    ...actual,
    getSelectedDatasetsMode: (...args: unknown[]) => mockGetSelectedDatasetsMode(...args),
  }
})

vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}))

describe('useConfiguration utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSelectedDatasetsMode.mockReturnValue({
      allExternal: false,
      allInternal: false,
      inconsistentEmbeddingModel: false,
      mixtureHighQualityAndEconomic: false,
      mixtureInternalAndExternal: false,
    })
  })

  it('should preserve persisted settings when loading and publishing without edits', async () => {
    const chatPrompt = {
      prompt: [{ role: 'tool', text: 'Tool result', name: 'lookup' }],
      vendor: { version: 1 },
    }
    const completionPrompt = {
      prompt: { text: 'Complete this', prefix: 'custom' },
      conversation_histories_role: {
        user_prefix: 'User',
        assistant_prefix: 'Assistant',
        separator: '\n',
      },
    }
    const agentMode = {
      enabled: true,
      strategy: 'react' as const,
      prompt: { first_prompt: 'Plan', next_iteration: 'Continue' },
      extension: { flags: [true, 'custom'] },
      tools: [
        { google_search: { enabled: true } },
        {
          enabled: true,
          provider_id: 'custom-tool',
          provider_type: 'api' as const,
          provider_name: 'custom-tool',
          tool_name: 'lookup',
          tool_parameters: { nested: { count: 2 } },
          extension: { protocol: 'custom' },
        },
      ],
    }
    const externalTools = [
      {
        enabled: true as const,
        type: 'custom',
        variable: 'lookup',
        config: { options: { retries: 2, flags: [true, 'fast'] } },
      },
    ]
    mockFetchCollectionList.mockResolvedValue([])
    mockFetchAppDetailDirect.mockResolvedValue(
      createAppDetailFixture({
        mode: AppModeEnum.AGENT_CHAT,
        model_config: createAppModelConfigFixture({
          model: {
            provider: 'langgenius/openai/openai',
            name: 'gpt-4o',
            mode: 'chat',
            completion_params: { temperature: 0.7 },
          },
          prompt_type: 'advanced',
          chat_prompt_config: chatPrompt,
          completion_prompt_config: completionPrompt,
          agent_mode: agentMode,
          external_data_tools: externalTools,
          file_upload: {
            enabled: true,
            allowed_file_upload_methods: ['datasource_file', 'tool_file'],
            image: { enabled: true, transfer_methods: ['datasource_file', 'tool_file'] },
          },
          dataset_configs: {
            retrieval_model: 'multiple',
            metadata_filtering_conditions: {
              logical_operator: 'and',
              conditions: [
                { id: 'tags', name: 'tags', comparison_operator: 'in', value: ['a', 'b'] },
              ],
            },
          },
        }),
      }),
    )

    const loaded = await loadConfigurationState({ appId: 'app-1' })
    const published = loaded.publishedConfig
    const body = buildPublishBody({
      chatPromptConfig: published.chatPromptConfig,
      completionParams: published.completionParams,
      completionPromptConfig: published.completionPromptConfig,
      dataSets: [],
      datasetConfigs: published.datasetConfigs,
      externalDataToolsConfig: published.externalDataToolsConfig,
      features: buildConfigurationFeaturesData(published.modelConfig, undefined),
      isAdvancedMode: true,
      isFunctionCall: false,
      modelConfig: published.modelConfig,
      modelId: published.modelConfig.model_id,
      modelProvider: published.modelConfig.provider,
      promptMode: published.promptMode,
      promptVariables: published.modelConfig.configs.prompt_variables,
      promptTemplate: published.modelConfig.configs.prompt_template,
      resolvedModelModeType: published.modelConfig.mode,
    })
    expect(zAppModelConfigPayload.safeParse(body).success).toBe(true)
    expect(body.chat_prompt_config).toEqual(chatPrompt)
    expect(body.completion_prompt_config).toEqual(completionPrompt)
    expect(body.agent_mode).toEqual(
      expect.objectContaining({ prompt: agentMode.prompt, extension: agentMode.extension }),
    )
    expect(body.agent_mode.tools).toEqual(
      expect.arrayContaining(agentMode.tools.map((tool) => expect.objectContaining(tool))),
    )
    expect(body.external_data_tools).toEqual(externalTools)
    expect(loaded.externalDataToolsConfig).toEqual(published.externalDataToolsConfig)
    expect(body.file_upload.allowed_file_upload_methods).toEqual(['datasource_file', 'tool_file'])
    expect(body.file_upload.image?.transfer_methods).toEqual(['datasource_file', 'tool_file'])
    expect(body.dataset_configs.metadata_filtering_conditions?.conditions?.[0]?.value).toEqual([
      'a',
      'b',
    ])
    expect(body).not.toHaveProperty('system_parameters')
  })

  it('should build the published config with external tools and agent metadata', () => {
    const publishedConfig = buildPublishedConfig({
      backendModelConfig: createAppModelConfigFixture({
        pre_prompt: 'hello {{name}}',
        user_input_form: [
          {
            'text-input': {
              variable: 'name',
              label: 'Name',
              required: true,
            },
          },
        ],
        dataset_query_variable: '',
        more_like_this: { enabled: true },
        opening_statement: 'hello',
        suggested_questions: ['how are you?'],
        sensitive_word_avoidance: { enabled: false },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false, voice: '', language: '' },
        file_upload: {},
        suggested_questions_after_answer: { enabled: false },
        retriever_resource: { enabled: false },
        annotation_reply: { enabled: false },
        external_data_tools: [
          {
            enabled: true,
            icon: 'icon',
            icon_background: '#fff',
            label: 'Search',
            type: 'search',
            variable: 'search',
            config: {},
          },
        ],
        dataset_configs: {
          retrieval_model: 'multiple',
          datasets: { datasets: [] },
        },
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: { temperature: 0.7 },
        },
        agent_mode: {
          enabled: false,
          strategy: AgentStrategy.react,
          tools: [
            {
              enabled: true,
              provider_id: 'tool-1',
              provider_name: 'builtin/search',
              provider_type: 'builtin',
              tool_name: 'search',
              tool_parameters: {},
            },
          ],
        },
      }),
      collectionList: [
        {
          id: 'tool-1',
          is_team_authorization: false,
        },
      ] as any,
      datasetConfigs: {
        datasets: { datasets: [] },
        retrieval_model: RETRIEVE_TYPE.multiWay,
        top_k: 4,
      } as any,
      deletedTools: [{ type: 'tool', provider_id: 'tool-1', tool_name: 'search' }],
      mode: AppModeEnum.AGENT_CHAT,
      nextDataSets: [{ id: 'dataset-1' }] as any,
    })

    expect(publishedConfig.completionParams).toEqual({ temperature: 0.7 })
    expect(publishedConfig.datasetConfigs.top_k).toBe(4)
    expect(publishedConfig.promptMode).toBe('simple')
    expect(publishedConfig.externalDataToolsConfig).toHaveLength(1)
    expect(publishedConfig.modelConfig).toEqual(
      expect.objectContaining({
        dataSets: [{ id: 'dataset-1' }],
        mode: ModelModeType.chat,
        model_id: 'gpt-4o',
        more_like_this: { enabled: true },
        opening_statement: 'hello',
        provider: 'langgenius/openai/openai',
        suggested_questions: ['how are you?'],
      }),
    )
    expect(publishedConfig.modelConfig.configs.prompt_variables).toHaveLength(2)
    expect(publishedConfig.modelConfig.agentConfig.tools[0]).toEqual(
      expect.objectContaining({
        isDeleted: true,
        notAuthor: true,
        tool_name: 'search',
        tool_parameters: {},
      }),
    )
  })

  it('should normalize an empty chat prompt config for completion apps', () => {
    const publishedConfig = buildPublishedConfig({
      backendModelConfig: createAppModelConfigFixture({
        chat_prompt_config: {},
        completion_prompt_config: {
          prompt: { text: 'completion' },
          conversation_histories_role: {
            assistant_prefix: '',
            user_prefix: '',
          },
        },
        dataset_configs: {
          retrieval_model: 'multiple',
          datasets: { datasets: [] },
        },
        external_data_tools: [],
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.completion,
          completion_params: {},
        },
        user_input_form: [],
      }),
      collectionList: [],
      datasetConfigs: {
        datasets: { datasets: [] },
        retrieval_model: RETRIEVE_TYPE.multiWay,
      } as any,
      mode: AppModeEnum.COMPLETION,
      nextDataSets: [],
    })

    expect(publishedConfig.chatPromptConfig).toEqual(DEFAULT_CHAT_PROMPT_CONFIG)
    expect(publishedConfig.modelConfig.chat_prompt_config).toEqual(DEFAULT_CHAT_PROMPT_CONFIG)
  })

  it('should normalize an empty completion prompt config for chat apps', () => {
    const publishedConfig = buildPublishedConfig({
      backendModelConfig: createAppModelConfigFixture({
        chat_prompt_config: {
          prompt: [{ role: 'system', text: 'chat' }],
        },
        completion_prompt_config: {},
        dataset_configs: {
          retrieval_model: 'multiple',
          datasets: { datasets: [] },
        },
        external_data_tools: [],
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: {},
        },
        user_input_form: [],
      }),
      collectionList: [],
      datasetConfigs: {
        datasets: { datasets: [] },
        retrieval_model: RETRIEVE_TYPE.multiWay,
      } as any,
      mode: AppModeEnum.CHAT,
      nextDataSets: [],
    })

    expect(publishedConfig.completionPromptConfig).toEqual(DEFAULT_COMPLETION_PROMPT_CONFIG)
    expect(publishedConfig.modelConfig.completion_prompt_config).toEqual(
      DEFAULT_COMPLETION_PROMPT_CONFIG,
    )
  })

  it('should build dataset configs with reranking defaults', () => {
    const datasetConfigs = buildConfigurationDatasetConfigs({
      backendModelConfig: createAppModelConfigFixture({
        dataset_configs: {
          retrieval_model: 'multiple',
          datasets: { datasets: [] },
          reranking_model: {
            reranking_model_name: 'rerank-1',
            reranking_provider_name: 'langgenius/cohere/cohere',
          },
        },
      }),
      currentRerankModel: 'rerank-1',
      currentRerankProvider: 'langgenius/cohere/cohere',
      nextDataSets: [],
    })

    expect(datasetConfigs.retrieval_model).toBe(RETRIEVE_TYPE.multiWay)
    expect(datasetConfigs.reranking_model).toEqual(
      expect.objectContaining({
        reranking_model_name: 'rerank-1',
      }),
    )
  })

  it('should build a publish body for advanced prompts and dataset selections', () => {
    const body = buildPublishBody({
      chatPromptConfig: { prompt: [{ role: 'system', text: 'hi' }] } as any,
      completionParams: { temperature: 0.7 },
      completionPromptConfig: {
        prompt: { text: 'completion' },
        conversation_histories_role: {
          assistant_prefix: 'assistant',
          user_prefix: 'user',
        },
      } as any,
      contextVar: 'context',
      dataSets: [{ id: 'dataset-1' }] as any,
      datasetConfigs: {
        retrieval_model: RETRIEVE_TYPE.multiWay,
        datasets: { datasets: [] },
      } as any,
      externalDataToolsConfig: [],
      features: {
        moreLikeThis: { enabled: true },
        opening: {
          enabled: true,
          opening_statement: 'hello',
          suggested_questions: ['how are you?'],
        },
        moderation: { enabled: false },
        speech2text: { enabled: false },
        text2speech: { enabled: false, voice: '', language: '' },
        file: {
          enabled: true,
          fileUploadConfig: { image: {} },
          image: {
            enabled: true,
            detail: 'high',
            number_limits: 2,
            transfer_methods: ['local_file'],
          },
        } as any,
        suggested: { enabled: false },
        citation: { enabled: true },
      } as any,
      isAdvancedMode: true,
      isFunctionCall: true,
      modelConfig: {
        agentConfig: {
          enabled: true,
          max_iteration: 3,
          strategy: AgentStrategy.react,
          tools: [],
        },
      } as any,
      modelId: 'gpt-4o',
      modelProvider: 'langgenius/openai/openai',
      promptMode: 'advanced' as any,
      promptTemplate: 'hello {{name}}',
      promptVariables: [{ key: 'name', name: 'Name', required: true, type: 'string' }] as any,
      resolvedModelModeType: ModelModeType.chat,
    })

    expect(body).toEqual(
      expect.objectContaining({
        chat_prompt_config: { prompt: [{ role: 'system', text: 'hi' }] },
        dataset_query_variable: 'context',
        opening_statement: 'hello',
        pre_prompt: '',
        prompt_type: 'advanced',
        suggested_questions: ['how are you?'],
      }),
    )
    expect(body.agent_mode?.strategy).toBe(AgentStrategy.functionCall)
    expect(body.dataset_configs?.datasets?.datasets).toEqual([
      { dataset: { enabled: true, id: 'dataset-1' } },
    ])
    expect(body.model).toEqual(
      expect.objectContaining({
        completion_params: { temperature: 0.7 },
        mode: ModelModeType.chat,
        name: 'gpt-4o',
        provider: 'langgenius/openai/openai',
      }),
    )
  })

  it('should load and normalize the initial configuration state', async () => {
    mockFetchCollectionList.mockResolvedValue([
      {
        id: 'tool-1',
        icon: '/tool.svg',
      },
    ])
    mockFetchAppDetailDirect.mockResolvedValue({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: createAppModelConfigFixture({
        prompt_type: 'advanced',
        chat_prompt_config: {
          prompt: [{ role: 'system', text: 'hi' }],
        },
        completion_prompt_config: {
          prompt: { text: 'completion' },
          conversation_histories_role: {
            assistant_prefix: 'assistant',
            user_prefix: 'user',
          },
        },
        dataset_configs: {
          retrieval_model: 'multiple',
          datasets: {
            datasets: [{ dataset: { id: 'dataset-1', enabled: true } }],
          },
        },
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: { temperature: 0.7 },
        },
        opening_statement: 'hello',
        suggested_questions: ['how are you?'],
        more_like_this: { enabled: true },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false, voice: '', language: '' },
        retriever_resource: { enabled: true },
        annotation_reply: {
          enabled: true,
          id: 'annotation-1',
          score_threshold: 0.9,
          embedding_model: {
            embedding_provider_name: 'langgenius/openai/openai',
            embedding_model_name: 'text-embedding-3-small',
          },
        },
        sensitive_word_avoidance: { enabled: false },
        external_data_tools: [],
        user_input_form: [],
        pre_prompt: '',
      }),
    })
    mockFetchDatasets.mockResolvedValue({
      data: [{ id: 'dataset-1', name: 'Dataset One' }],
    })

    const state = await loadConfigurationState({
      appId: 'app-1',
      basePath: '/console',
    })

    expect(mockFetchCollectionList).toHaveBeenCalledTimes(1)
    expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
    expect(mockFetchDatasets).toHaveBeenCalledWith({
      params: {
        ids: ['dataset-1'],
        page: 1,
      },
      url: '/datasets',
    })
    expect(state.collectionList[0]!.icon).toBe('/console/tool.svg')
    expect(state.promptMode).toBe('advanced')
    expect(state.nextDataSets).toEqual([{ id: 'dataset-1', name: 'Dataset One' }])
    expect(state.annotationConfig).toEqual(
      expect.objectContaining({
        enabled: true,
        embedding_model: expect.objectContaining({
          embedding_provider_name: 'langgenius/openai/openai',
        }),
      }),
    )
    expect(state.publishedConfig.modelConfig.model_id).toBe('gpt-4o')
  })

  it('should load dataset tools from agent mode and keep disabled annotation config unchanged', async () => {
    mockFetchCollectionList.mockResolvedValue([])
    mockFetchDatasets.mockResolvedValue({
      data: [{ id: 'dataset-from-tool', name: 'Dataset From Tool' }],
    })
    mockFetchAppDetailDirect.mockResolvedValue({
      deleted_tools: [],
      mode: AppModeEnum.AGENT_CHAT,
      model_config: createAppModelConfigFixture({
        prompt_type: 'simple',
        chat_prompt_config: { prompt: [] },
        completion_prompt_config: undefined,
        dataset_configs: {
          retrieval_model: 'multiple',
          datasets: { datasets: [] },
        },
        agent_mode: {
          enabled: false,
          tools: [
            {
              dataset: {
                enabled: true,
                id: 'dataset-from-tool',
              },
            },
          ],
        },
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: {},
        },
        annotation_reply: { enabled: false },
        more_like_this: undefined,
        speech_to_text: undefined,
        text_to_speech: undefined,
        retriever_resource: undefined,
        suggested_questions: undefined,
        suggested_questions_after_answer: undefined,
        external_data_tools: [],
        user_input_form: [],
        pre_prompt: '',
      }),
    })

    const state = await loadConfigurationState({ appId: 'app-2' })

    expect(mockFetchDatasets).toHaveBeenCalledWith({
      url: '/datasets',
      params: {
        page: 1,
        ids: ['dataset-from-tool'],
      },
    })
    expect(state.nextDataSets).toEqual([{ id: 'dataset-from-tool', name: 'Dataset From Tool' }])
    expect(state.annotationConfig).toEqual(
      expect.objectContaining({
        enabled: false,
      }),
    )
    expect(state.chatPromptConfig).toEqual(expect.any(Object))
  })

  it('should initialize the disabled annotation draft from the response', async () => {
    mockFetchCollectionList.mockResolvedValue([])
    mockFetchAppDetailDirect.mockResolvedValue({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: createAppModelConfigFixture({
        prompt_type: 'simple',
        chat_prompt_config: { prompt: [] },
        completion_prompt_config: undefined,
        dataset_configs: {
          retrieval_model: 'multiple',
          datasets: { datasets: [] },
        },
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: {},
        },
        more_like_this: undefined,
        speech_to_text: undefined,
        text_to_speech: undefined,
        retriever_resource: undefined,
        suggested_questions: undefined,
        suggested_questions_after_answer: undefined,
        external_data_tools: [],
        user_input_form: [],
        pre_prompt: '',
      }),
    })

    const state = await loadConfigurationState({ appId: 'app-3' })

    expect(state.annotationConfig).toEqual(expect.objectContaining({ enabled: false, id: '' }))
  })

  it('should hydrate selected datasets and open the rerank modal when selection changes', () => {
    const setDataSets = vi.fn()
    const setDatasetConfigs = vi.fn()
    const setRerankSettingModalOpen = vi.fn()
    const hideSelectDataSet = vi.fn()
    const formattingChangedDispatcher = vi.fn()

    const handleSelect = createDatasetSelectHandler({
      currentRerankModel: 'rerank-1',
      currentRerankProvider: 'langgenius/cohere/cohere',
      dataSets: [{ id: 'dataset-1', name: 'Dataset One' }] as any,
      datasetConfigs: {
        datasets: { datasets: [] },
        reranking_enable: false,
        reranking_model: {
          reranking_model_name: '',
          reranking_provider_name: '',
        },
        retrieval_model: RETRIEVE_TYPE.multiWay,
        score_threshold: 0.5,
        score_threshold_enabled: false,
        top_k: 3,
      } as any,
      datasetConfigsRef: {
        current: {
          datasets: { datasets: [] },
          reranking_model: {
            reranking_model_name: '',
            reranking_provider_name: '',
          },
          retrieval_model: RETRIEVE_TYPE.multiWay,
          score_threshold_enabled: false,
        } as any,
      },
      formattingChangedDispatcher,
      hideSelectDataSet,
      setDataSets,
      setDatasetConfigs,
      setRerankSettingModalOpen,
    })

    handleSelect([{ id: 'dataset-2' }] as any)

    expect(formattingChangedDispatcher).toHaveBeenCalledTimes(1)
    expect(setDataSets).toHaveBeenCalledWith([{ id: 'dataset-2' }])
    expect(hideSelectDataSet).toHaveBeenCalledTimes(1)
    expect(setDatasetConfigs).toHaveBeenCalledTimes(1)
  })

  it('should reuse the current dataset metadata when a renamed selection omits names', () => {
    const setDataSets = vi.fn()
    const setDatasetConfigs = vi.fn()

    const handleSelect = createDatasetSelectHandler({
      currentRerankModel: 'rerank-1',
      currentRerankProvider: 'langgenius/cohere/cohere',
      dataSets: [{ id: 'dataset-1', name: 'Dataset One' }] as any,
      datasetConfigs: {
        datasets: { datasets: [] },
        retrieval_model: RETRIEVE_TYPE.multiWay,
        score_threshold_enabled: false,
      } as any,
      datasetConfigsRef: {
        current: {
          datasets: { datasets: [] },
          retrieval_model: RETRIEVE_TYPE.multiWay,
          score_threshold_enabled: false,
        } as any,
      },
      formattingChangedDispatcher: vi.fn(),
      hideSelectDataSet: vi.fn(),
      setDataSets,
      setDatasetConfigs,
      setRerankSettingModalOpen: vi.fn(),
    })

    handleSelect([{ id: 'dataset-1' }, { id: 'dataset-2', name: 'Dataset Two' }] as any)

    expect(setDataSets).toHaveBeenCalledWith([
      { id: 'dataset-1', name: 'Dataset One' },
      { id: 'dataset-2', name: 'Dataset Two' },
    ])
  })

  it('should only hide the selector when dataset selections do not change', () => {
    const formattingChangedDispatcher = vi.fn()
    const hideSelectDataSet = vi.fn()
    const setDataSets = vi.fn()
    const setDatasetConfigs = vi.fn()
    const handleSelect = createDatasetSelectHandler({
      currentRerankModel: 'rerank-1',
      currentRerankProvider: 'langgenius/cohere/cohere',
      dataSets: [{ id: 'dataset-1', name: 'Dataset One' }] as any,
      datasetConfigs: {
        datasets: { datasets: [] },
        retrieval_model: RETRIEVE_TYPE.multiWay,
        score_threshold_enabled: false,
      } as any,
      datasetConfigsRef: { current: {} as any },
      formattingChangedDispatcher,
      hideSelectDataSet,
      setDataSets,
      setDatasetConfigs,
      setRerankSettingModalOpen: vi.fn(),
    })

    handleSelect([{ id: 'dataset-1', name: 'Dataset One' }] as any)

    expect(hideSelectDataSet).toHaveBeenCalledTimes(1)
    expect(formattingChangedDispatcher).not.toHaveBeenCalled()
    expect(setDataSets).not.toHaveBeenCalled()
    expect(setDatasetConfigs).not.toHaveBeenCalled()
  })

  it('should keep named datasets and open rerank settings when the selection mode requires it', () => {
    const setDataSets = vi.fn()
    const setRerankSettingModalOpen = vi.fn()
    const nextDataSets = [{ id: 'dataset-2', name: 'Dataset Two' }]
    mockGetSelectedDatasetsMode.mockReturnValue({
      allExternal: true,
      allInternal: false,
      inconsistentEmbeddingModel: false,
      mixtureHighQualityAndEconomic: false,
      mixtureInternalAndExternal: false,
    })

    const handleSelect = createDatasetSelectHandler({
      currentRerankModel: 'rerank-1',
      currentRerankProvider: 'langgenius/cohere/cohere',
      dataSets: [] as any,
      datasetConfigs: {
        datasets: { datasets: [] },
        retrieval_model: RETRIEVE_TYPE.multiWay,
        score_threshold_enabled: false,
      } as any,
      datasetConfigsRef: {
        current: {
          datasets: { datasets: [] },
          retrieval_model: RETRIEVE_TYPE.multiWay,
          score_threshold_enabled: false,
        } as any,
      },
      formattingChangedDispatcher: vi.fn(),
      hideSelectDataSet: vi.fn(),
      setDataSets,
      setDatasetConfigs: vi.fn(),
      setRerankSettingModalOpen,
    })

    handleSelect(nextDataSets as any)

    expect(setDataSets).toHaveBeenCalledWith(nextDataSets)
    expect(setRerankSettingModalOpen).toHaveBeenCalledWith(true)
  })

  it('should validate and publish configuration changes', async () => {
    const setPublishedConfig = vi.fn()
    const setCanReturnToSimpleMode = vi.fn()
    const mockUpdateAppModelConfig = vi.fn().mockResolvedValue(undefined)

    const onPublish = createPublishHandler({
      appId: 'app-1',
      chatPromptConfig: { prompt: [{ role: 'system', text: 'hi' }] } as any,
      completionParamsState: { temperature: 0.7 },
      completionPromptConfig: {
        prompt: { text: 'completion' },
        conversation_histories_role: {
          assistant_prefix: 'assistant',
          user_prefix: 'user',
        },
      } as any,
      contextVar: 'context',
      contextVarEmpty: false,
      dataSets: [{ id: 'dataset-1' }] as any,
      datasetConfigs: {
        datasets: { datasets: [] },
        retrieval_model: RETRIEVE_TYPE.multiWay,
        top_k: 7,
      } as any,
      externalDataToolsConfig: [{ enabled: true, variable: 'external' }] as any,
      hasSetBlockStatus: {
        history: true,
        query: true,
      },
      isAdvancedMode: true,
      isFunctionCall: true,
      mode: AppModeEnum.CHAT,
      modelConfig: {
        agentConfig: {
          enabled: true,
          max_iteration: 3,
          strategy: AgentStrategy.react,
          tools: [],
        },
        configs: {
          prompt_template: 'hello {{name}}',
          prompt_variables: [{ key: 'name', name: 'Name', required: true, type: 'string' }],
        },
        model_id: 'gpt-4o',
        provider: 'langgenius/openai/openai',
      } as any,
      promptEmpty: false,
      promptMode: 'advanced' as any,
      resolvedModelModeType: ModelModeType.chat,
      setCanReturnToSimpleMode,
      setPublishedConfig,
      t,
    })

    const result = await onPublish(
      mockUpdateAppModelConfig,
      {
        model: 'published-model',
        provider: 'published-provider',
        parameters: { temperature: 0.2 },
      },
      {
        moreLikeThis: { enabled: true },
        opening: { enabled: false, opening_statement: '', suggested_questions: [] },
        moderation: { enabled: true },
        speech2text: { enabled: false },
        text2speech: { enabled: false, voice: '', language: '' },
        file: {
          enabled: false,
          image: {
            enabled: false,
            detail: 'low',
            number_limits: 1,
            transfer_methods: ['local_file'],
          },
        } as any,
        suggested: { enabled: false },
        citation: { enabled: true },
      } as any,
    )

    expect(result).toBe(true)
    expect(mockUpdateAppModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_mode: expect.objectContaining({
            strategy: AgentStrategy.functionCall,
          }),
        }),
        params: { app_id: 'app-1' },
      }),
    )
    expect(setPublishedConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        chatPromptConfig: { prompt: [{ role: 'system', text: 'hi' }] },
        completionParams: { temperature: 0.2 },
        datasetConfigs: expect.objectContaining({ top_k: 7 }),
        externalDataToolsConfig: [{ enabled: true, variable: 'external' }],
        modelConfig: expect.objectContaining({
          file_upload: expect.objectContaining({
            image: expect.objectContaining({ detail: 'low' }),
          }),
          model_id: 'published-model',
          opening_statement: '',
          provider: 'published-provider',
          sensitive_word_avoidance: { enabled: true },
        }),
        promptMode: 'advanced',
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith('api.success')
    expect(setCanReturnToSimpleMode).toHaveBeenCalledWith(false)
  })

  it('should block publish when required prompt sections are missing', async () => {
    const mockUpdateAppModelConfig = vi.fn()
    const createBasePublishHandler = (overrides: Record<string, unknown>) =>
      createPublishHandler({
        appId: 'app-1',
        chatPromptConfig: { prompt: [{ role: 'system', text: 'hi' }] } as any,
        completionParamsState: { temperature: 0.7 },
        completionPromptConfig: {
          prompt: { text: 'completion' },
          conversation_histories_role: {
            assistant_prefix: 'assistant',
            user_prefix: 'user',
          },
        } as any,
        contextVar: 'context',
        contextVarEmpty: false,
        dataSets: [] as any,
        datasetConfigs: { datasets: { datasets: [] } } as any,
        externalDataToolsConfig: [],
        hasSetBlockStatus: {
          history: true,
          query: true,
        },
        isAdvancedMode: true,
        isFunctionCall: false,
        mode: AppModeEnum.CHAT,
        modelConfig: {
          configs: {
            prompt_template: 'hello',
            prompt_variables: [],
          },
          model_id: 'gpt-4o',
          provider: 'langgenius/openai/openai',
        } as any,
        promptEmpty: false,
        promptMode: 'advanced' as any,
        resolvedModelModeType: ModelModeType.completion,
        setCanReturnToSimpleMode: vi.fn(),
        setPublishedConfig: vi.fn(),
        t,
        ...overrides,
      })

    await createBasePublishHandler({ promptEmpty: true })(mockUpdateAppModelConfig)
    await createBasePublishHandler({ hasSetBlockStatus: { history: false, query: true } })(
      mockUpdateAppModelConfig,
    )
    await createBasePublishHandler({ hasSetBlockStatus: { history: true, query: false } })(
      mockUpdateAppModelConfig,
    )
    await createBasePublishHandler({ contextVarEmpty: true })(mockUpdateAppModelConfig)

    expect(mockToastError).toHaveBeenNthCalledWith(1, 'otherError.promptNoBeEmpty')
    expect(mockToastError).toHaveBeenNthCalledWith(2, 'otherError.historyNoBeEmpty')
    expect(mockToastError).toHaveBeenNthCalledWith(3, 'otherError.queryNoBeEmpty')
    expect(mockToastError).toHaveBeenNthCalledWith(
      4,
      'feature.dataSet.queryVariable.contextVarNotEmpty',
    )
    expect(mockUpdateAppModelConfig).not.toHaveBeenCalled()
  })

  it('should migrate prompts, update vision support, and merge completion params on model change', async () => {
    const handleSetVisionConfig = vi.fn()
    const migrateToDefaultPrompt = vi.fn()
    const setCompletionParams = vi.fn()
    const setModelConfig = vi.fn()

    mockFetchAndMergeValidCompletionParams.mockResolvedValue({
      params: { temperature: 0.3 },
      removedDetails: {},
    })

    const onModelChange = createModelChangeHandler({
      chatPromptLength: 0,
      completionParamsState: { temperature: 0.7 },
      completionPromptConfig: {
        prompt: { text: '' },
        conversation_histories_role: {
          assistant_prefix: '',
          user_prefix: '',
        },
      },
      handleSetVisionConfig,
      isAdvancedMode: true,
      migrateToDefaultPrompt,
      mode: AppModeEnum.CHAT,
      modelConfig: {
        model_id: 'gpt-4o-mini',
        provider: 'langgenius/openai/openai',
      } as any,
      resolvedModelModeType: ModelModeType.chat,
      setCompletionParams,
      setModelConfig,
      t,
      visionConfig: baseVisionConfig,
    })

    await onModelChange({
      features: ['vision'],
      mode: ModelModeType.completion,
      modelId: 'gpt-4o',
      provider: 'langgenius/openai/openai',
    })

    expect(migrateToDefaultPrompt).toHaveBeenCalledWith(true, ModelModeType.completion)
    expect(setModelConfig).toHaveBeenCalledTimes(1)
    expect(handleSetVisionConfig).toHaveBeenCalledWith(
      {
        ...baseVisionConfig,
        enabled: true,
      },
      true,
    )
    expect(setCompletionParams).toHaveBeenCalledWith({ temperature: 0.3 })
  })

  it('should warn when parameters are removed and reset params on fetch failure', async () => {
    const handleSetVisionConfig = vi.fn()
    const migrateToDefaultPrompt = vi.fn()
    const setCompletionParams = vi.fn()
    const setModelConfig = vi.fn()

    mockFetchAndMergeValidCompletionParams
      .mockResolvedValueOnce({
        params: { temperature: 0.3 },
        removedDetails: { top_k: 'unsupported' },
      })
      .mockRejectedValueOnce(new Error('boom'))

    const onModelChange = createModelChangeHandler({
      chatPromptLength: 0,
      completionParamsState: { temperature: 0.7 },
      completionPromptConfig: {
        prompt: { text: '' },
        conversation_histories_role: {
          assistant_prefix: 'assistant',
          user_prefix: 'user',
        },
      },
      handleSetVisionConfig,
      isAdvancedMode: true,
      migrateToDefaultPrompt,
      mode: AppModeEnum.COMPLETION,
      modelConfig: {
        model_id: 'gpt-4o-mini',
        provider: 'langgenius/openai/openai',
      } as any,
      resolvedModelModeType: ModelModeType.chat,
      setCompletionParams,
      setModelConfig,
      t,
      visionConfig: baseVisionConfig,
    })

    await onModelChange({
      features: [],
      mode: ModelModeType.completion,
      modelId: 'gpt-4o',
      provider: 'langgenius/openai/openai',
    })
    await onModelChange({
      features: [],
      mode: ModelModeType.chat,
      modelId: 'gpt-4.1',
      provider: 'langgenius/openai/openai',
    })

    expect(migrateToDefaultPrompt).toHaveBeenCalledWith(true, ModelModeType.completion)
    expect(migrateToDefaultPrompt).toHaveBeenCalledWith(true, ModelModeType.chat)
    expect(mockToastWarning).toHaveBeenCalledWith(
      'modelProvider.parametersInvalidRemoved: top_k (unsupported)',
    )
    expect(mockToastError).toHaveBeenCalledWith('error')
    expect(setCompletionParams).toHaveBeenCalledWith({})
  })
})
