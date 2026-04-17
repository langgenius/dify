/* eslint-disable ts/no-explicit-any */
import type { VisionSettings } from '@/types/app'
import { AgentStrategy, AppModeEnum, ModelModeType, Resolution, RETRIEVE_TYPE, TransferMethod } from '@/types/app'
import {
  buildConfigurationDatasetConfigs,
  buildPublishBody,
  buildPublishedConfig,
  createDatasetSelectHandler,
  createModelChangeHandler,
  createPublishHandler,
  loadConfigurationState,
} from '../use-configuration-utils'

const mockFetchAppDetailDirect = vi.fn()
const mockFetchDatasets = vi.fn()
const mockFetchCollectionList = vi.fn()
const mockFetchAndMergeValidCompletionParams = vi.fn()
const mockGetSelectedDatasetsMode = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastWarning = vi.fn()

const baseVisionConfig: VisionSettings = {
  enabled: false,
  number_limits: 1,
  detail: Resolution.high,
  transfer_methods: [TransferMethod.remote_url],
}

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
}))

vi.mock('@/service/datasets', () => ({
  fetchDatasets: (...args: unknown[]) => mockFetchDatasets(...args),
}))

vi.mock('@/service/tools', () => ({
  fetchCollectionList: (...args: unknown[]) => mockFetchCollectionList(...args),
}))

vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: (...args: unknown[]) => mockFetchAndMergeValidCompletionParams(...args),
}))

vi.mock('@/app/components/workflow/nodes/knowledge-retrieval/utils', async () => {
  const actual = await vi.importActual<any>('@/app/components/workflow/nodes/knowledge-retrieval/utils')

  return {
    ...actual,
    getSelectedDatasetsMode: (...args: unknown[]) => mockGetSelectedDatasetsMode(...args),
  }
})

vi.mock('@/app/components/base/ui/toast', () => ({
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

  it('should build the published config with external tools and agent metadata', () => {
    const publishedConfig = buildPublishedConfig({
      backendModelConfig: {
        pre_prompt: 'hello {{name}}',
        user_input_form: [
          {
            text_input: {
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
        file_upload: null,
        suggested_questions_after_answer: { enabled: false },
        retriever_resource: { enabled: false },
        annotation_reply: null,
        external_data_tools: [
          {
            enabled: true,
            icon: 'icon',
            icon_background: '#fff',
            label: 'Search',
            type: 'search',
            variable: 'search',
          },
        ],
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
        dataset_configs: {
          datasets: { datasets: [] },
        },
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: { temperature: 0.7 },
        },
        agent_mode: {
          strategy: AgentStrategy.react,
          tools: [
            {
              enabled: true,
              provider_id: 'tool-1',
              provider_name: 'builtin/search',
              provider_type: 'builtin',
              tool_name: 'search',
            },
          ],
        },
      } as any,
      collectionList: [
        {
          id: 'tool-1',
          is_team_authorization: false,
        },
      ] as any,
      deletedTools: [{ provider_id: 'tool-1', tool_name: 'search' }],
      mode: AppModeEnum.AGENT_CHAT,
      nextDataSets: [{ id: 'dataset-1' }] as any,
    })

    expect(publishedConfig.completionParams).toEqual({ temperature: 0.7 })
    expect(publishedConfig.modelConfig).toEqual(expect.objectContaining({
      dataSets: [{ id: 'dataset-1' }],
      mode: ModelModeType.chat,
      model_id: 'gpt-4o',
      more_like_this: { enabled: true },
      opening_statement: 'hello',
      provider: 'langgenius/openai/openai',
      suggested_questions: ['how are you?'],
    }))
    expect(publishedConfig.modelConfig.configs.prompt_variables).toHaveLength(2)
    expect(publishedConfig.modelConfig.agentConfig.tools[0]).toEqual(expect.objectContaining({
      isDeleted: true,
      notAuthor: true,
      tool_name: 'search',
    }))
  })

  it('should build dataset configs with reranking defaults', () => {
    const datasetConfigs = buildConfigurationDatasetConfigs({
      backendModelConfig: {
        dataset_configs: {
          datasets: { datasets: [] },
          reranking_model: {
            reranking_model_name: 'rerank-1',
            reranking_provider_name: 'langgenius/cohere/cohere',
          },
        },
      } as any,
      currentRerankModel: 'rerank-1',
      currentRerankProvider: 'langgenius/cohere/cohere',
      nextDataSets: [],
    })

    expect(datasetConfigs.retrieval_model).toBe(RETRIEVE_TYPE.multiWay)
    expect(datasetConfigs.reranking_model).toEqual(expect.objectContaining({
      reranking_model_name: 'rerank-1',
    }))
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
        opening: { enabled: true, opening_statement: 'hello', suggested_questions: ['how are you?'] },
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
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      } as any,
      modelId: 'gpt-4o',
      modelProvider: 'langgenius/openai/openai',
      promptMode: 'advanced' as any,
      promptTemplate: 'hello {{name}}',
      promptVariables: [{ key: 'name', name: 'Name', required: true, type: 'string' }] as any,
      resolvedModelModeType: ModelModeType.chat,
    })

    expect(body).toEqual(expect.objectContaining({
      chat_prompt_config: { prompt: [{ role: 'system', text: 'hi' }] },
      dataset_query_variable: 'context',
      opening_statement: 'hello',
      pre_prompt: '',
      prompt_type: 'advanced',
      suggested_questions: ['how are you?'],
    }))
    expect(body.agent_mode?.strategy).toBe(AgentStrategy.functionCall)
    expect(body.dataset_configs?.datasets?.datasets).toEqual([
      { dataset: { enabled: true, id: 'dataset-1' } },
    ])
    expect(body.model).toEqual(expect.objectContaining({
      completion_params: { temperature: 0.7 },
      mode: ModelModeType.chat,
      name: 'gpt-4o',
      provider: 'langgenius/openai/openai',
    }))
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
      model_config: {
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
          datasets: {
            datasets: [{ id: 'dataset-1' }],
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
          embedding_model: {
            embedding_provider_name: 'langgenius/openai/openai',
            embedding_model_name: 'text-embedding-3-small',
          },
        },
        sensitive_word_avoidance: { enabled: false },
        external_data_tools: [],
        user_input_form: [],
        pre_prompt: '',
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      },
    })
    mockFetchDatasets.mockResolvedValue({
      data: [{ id: 'dataset-1', name: 'Dataset One' }],
    })

    const state = await loadConfigurationState({
      appId: 'app-1',
      basePath: '/console',
    })

    expect(mockFetchCollectionList).toHaveBeenCalledTimes(1)
    expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
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
    expect(state.annotationConfig).toEqual(expect.objectContaining({
      enabled: true,
      embedding_model: expect.objectContaining({
        embedding_provider_name: 'langgenius/openai/openai',
      }),
    }))
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
      model_config: {
        prompt_type: 'simple',
        chat_prompt_config: { prompt: [] },
        completion_prompt_config: undefined,
        dataset_configs: {
          datasets: { datasets: [] },
        },
        agent_mode: {
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
        annotation_reply: {
          enabled: false,
          embedding_model: {
            embedding_provider_name: 'langgenius/openai/openai',
            embedding_model_name: 'text-embedding-3-small',
          },
        },
        more_like_this: undefined,
        speech_to_text: undefined,
        text_to_speech: undefined,
        retriever_resource: undefined,
        suggested_questions: undefined,
        suggested_questions_after_answer: undefined,
        external_data_tools: undefined,
        user_input_form: [],
        pre_prompt: '',
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      },
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
    expect(state.annotationConfig).toEqual(expect.objectContaining({
      enabled: false,
    }))
    expect(state.chatPromptConfig).toEqual(expect.any(Object))
  })

  it('should keep annotation config undefined when app detail does not include annotation settings', async () => {
    mockFetchCollectionList.mockResolvedValue([])
    mockFetchAppDetailDirect.mockResolvedValue({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: {
        prompt_type: 'simple',
        chat_prompt_config: { prompt: [] },
        completion_prompt_config: undefined,
        dataset_configs: {
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
        external_data_tools: undefined,
        user_input_form: [],
        pre_prompt: '',
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      },
    })

    const state = await loadConfigurationState({ appId: 'app-3' })

    expect(state.annotationConfig).toBeUndefined()
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

    handleSelect([
      { id: 'dataset-1' },
      { id: 'dataset-2', name: 'Dataset Two' },
    ] as any)

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
      citationConfig: { enabled: true } as any,
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
      } as any,
      externalDataToolsConfig: [],
      hasSetBlockStatus: {
        history: true,
        query: true,
      },
      introduction: 'hello',
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
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      } as any,
      moreLikeThisConfig: { enabled: true },
      promptEmpty: false,
      promptMode: 'advanced' as any,
      resolvedModelModeType: ModelModeType.chat,
      setCanReturnToSimpleMode,
      setPublishedConfig,
      speechToTextConfig: { enabled: false } as any,
      suggestedQuestionsAfterAnswerConfig: { enabled: false } as any,
      t: (key: string) => key,
      textToSpeechConfig: { enabled: false, voice: '', language: '' } as any,
    })

    const result = await onPublish(mockUpdateAppModelConfig, undefined, {
      moreLikeThis: { enabled: true },
      opening: { enabled: false, opening_statement: '', suggested_questions: [] },
      moderation: { enabled: false },
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
    } as any)

    expect(result).toBe(true)
    expect(mockUpdateAppModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        agent_mode: expect.objectContaining({
          strategy: AgentStrategy.functionCall,
        }),
      }),
      url: '/apps/app-1/model-config',
    }))
    expect(setPublishedConfig).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).toHaveBeenCalledWith('api.success')
    expect(setCanReturnToSimpleMode).toHaveBeenCalledWith(false)
  })

  it('should block publish when required prompt sections are missing', async () => {
    const mockUpdateAppModelConfig = vi.fn()
    const createBasePublishHandler = (overrides: Record<string, unknown>) => createPublishHandler({
      appId: 'app-1',
      chatPromptConfig: { prompt: [{ role: 'system', text: 'hi' }] } as any,
      citationConfig: { enabled: false } as any,
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
      introduction: 'hello',
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
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      } as any,
      moreLikeThisConfig: { enabled: false },
      promptEmpty: false,
      promptMode: 'advanced' as any,
      resolvedModelModeType: ModelModeType.completion,
      setCanReturnToSimpleMode: vi.fn(),
      setPublishedConfig: vi.fn(),
      speechToTextConfig: { enabled: false } as any,
      suggestedQuestionsAfterAnswerConfig: { enabled: false } as any,
      t: (key: string) => key,
      textToSpeechConfig: { enabled: false, voice: '', language: '' } as any,
      ...overrides,
    })

    await createBasePublishHandler({ promptEmpty: true })(mockUpdateAppModelConfig)
    await createBasePublishHandler({ hasSetBlockStatus: { history: false, query: true } })(mockUpdateAppModelConfig)
    await createBasePublishHandler({ hasSetBlockStatus: { history: true, query: false } })(mockUpdateAppModelConfig)
    await createBasePublishHandler({ contextVarEmpty: true })(mockUpdateAppModelConfig)

    expect(mockToastError).toHaveBeenNthCalledWith(1, 'otherError.promptNoBeEmpty')
    expect(mockToastError).toHaveBeenNthCalledWith(2, 'otherError.historyNoBeEmpty')
    expect(mockToastError).toHaveBeenNthCalledWith(3, 'otherError.queryNoBeEmpty')
    expect(mockToastError).toHaveBeenNthCalledWith(4, 'feature.dataSet.queryVariable.contextVarNotEmpty')
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
      t: (key: string) => key,
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
    expect(handleSetVisionConfig).toHaveBeenCalledWith({
      ...baseVisionConfig,
      enabled: true,
    }, true)
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
      t: (key: string) => key,
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
    expect(mockToastWarning).toHaveBeenCalledWith('modelProvider.parametersInvalidRemoved: top_k (unsupported)')
    expect(mockToastError).toHaveBeenCalledWith('error')
    expect(setCompletionParams).toHaveBeenCalledWith({})
  })
})
