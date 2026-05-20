/* eslint-disable ts/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react'
import { updateAppModelConfig } from '@/service/apps'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { useConfiguration } from '../use-configuration'

const mockSetShowAccountSettingModal = vi.fn()
const mockSetAppSidebarExpand = vi.fn()
const mockSetShowAppConfigureFeaturesModal = vi.fn()
const mockHandleMultipleModelConfigsChange = vi.fn()
const mockFetchCollectionList = vi.fn()
const mockFetchAppDetailDirect = vi.fn()
const mockFetchDatasets = vi.fn()
const mockFetchAndMergeValidCompletionParams = vi.fn()
const mockFormattingChangedDispatcher = vi.fn()
const mockMigrateToDefaultPrompt = vi.fn()
const mockSetConversationHistoriesRole = vi.fn()
const mockSetChatPromptConfig = vi.fn()
const mockSetCompletionPromptConfig = vi.fn()
const mockSetCurrentAdvancedPrompt = vi.fn()
type AdvancedPromptConfigOptions = {
  onUserChangedPrompt: () => void
  setStop: (stop: string[]) => void
}

let latestAdvancedPromptConfigOptions: AdvancedPromptConfigOptions | undefined
let mockTempStopState: string[] = []
let mockCurrentModelFeatures = ['vision']
let mockCurrentModelMode = ModelModeType.chat

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<any>('ahooks')

  return {
    ...actual,
    useGetState: () => [
      mockTempStopState,
      (value: string[]) => {
        mockTempStopState = value
      },
      () => mockTempStopState,
    ],
  }
})

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    isAPIKeySet: true,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: {
      id: 'app-1',
      model_config: {
        updated_at: 1710000000,
      },
      mode: AppModeEnum.CHAT,
    },
    setAppSidebarExpand: mockSetAppSidebarExpand,
    showAppConfigureFeaturesModal: false,
    setShowAppConfigureFeaturesModal: mockSetShowAppConfigureFeaturesModal,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: undefined,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
  },
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/app-1/configuration',
}))

vi.mock('@/app/components/app/configuration/debug/hooks', () => ({
  useDebugWithSingleOrMultipleModel: () => ({
    debugWithMultipleModel: false,
    multipleModelConfigs: [],
    handleMultipleModelConfigsChange: mockHandleMultipleModelConfigsChange,
  }),
  useFormattingChangedDispatcher: () => mockFormattingChangedDispatcher,
}))

vi.mock('../use-advanced-prompt-config', () => ({
  default: (options: AdvancedPromptConfigOptions) => {
    latestAdvancedPromptConfigOptions = options
    return {
      chatPromptConfig: { prompt: [{ role: 'system', text: 'hi' }] },
      setChatPromptConfig: mockSetChatPromptConfig,
      completionPromptConfig: {
        prompt: { text: 'completion' },
        conversation_histories_role: {
          assistant_prefix: 'assistant',
          user_prefix: 'user',
        },
      },
      setCompletionPromptConfig: mockSetCompletionPromptConfig,
      currentAdvancedPrompt: [],
      setCurrentAdvancedPrompt: mockSetCurrentAdvancedPrompt,
      hasSetBlockStatus: {
        context: false,
        history: true,
        query: true,
      },
      setConversationHistoriesRole: mockSetConversationHistoriesRole,
      migrateToDefaultPrompt: mockMigrateToDefaultPrompt,
    }
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    currentModel: { model: 'rerank-1' },
    currentProvider: { provider: 'langgenius/cohere/cohere' },
  }),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentModel: {
      features: mockCurrentModelFeatures,
      model_properties: {
        mode: mockCurrentModelMode,
      },
    },
  }),
}))

vi.mock('@/service/tools', () => ({
  fetchCollectionList: (...args: unknown[]) => mockFetchCollectionList(...args),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
  updateAppModelConfig: vi.fn(),
}))

vi.mock('@/service/datasets', () => ({
  fetchDatasets: (...args: unknown[]) => mockFetchDatasets(...args),
}))

vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: (...args: unknown[]) => mockFetchAndMergeValidCompletionParams(...args),
}))

describe('useConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestAdvancedPromptConfigOptions = undefined
    mockTempStopState = []
    mockCurrentModelFeatures = ['vision']
    mockCurrentModelMode = ModelModeType.chat
    mockFetchCollectionList.mockResolvedValue([])
    mockFetchDatasets.mockResolvedValue({ data: [] })
    mockFetchAndMergeValidCompletionParams.mockResolvedValue({
      params: { temperature: 0.3 },
      removedDetails: {},
    })
    vi.mocked(updateAppModelConfig).mockResolvedValue(undefined as never)
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
            datasets: [],
          },
        },
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: { temperature: 0.7 },
        },
        user_input_form: [],
        pre_prompt: '',
        opening_statement: 'hello',
        suggested_questions: ['how are you?'],
        more_like_this: { enabled: true },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false, voice: '', language: '' },
        retriever_resource: { enabled: true },
        annotation_reply: null,
        sensitive_word_avoidance: { enabled: false },
        external_data_tools: [],
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      },
    })
  })

  it('should load configuration state and expose the derived view model', async () => {
    const { result } = renderHook(() => useConfiguration())

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.isAdvancedMode).toBe(true)
    expect(result.current.contextValue.introduction).toBe('hello')
    expect(result.current.contextValue.suggestedQuestions).toEqual(['how are you?'])
    expect(result.current.appPublisherProps.publishedConfig.modelConfig.model_id).toBe('gpt-4o')
    expect(result.current.contextValue.isShowVisionConfig).toBe(true)
  })

  it('should update model parameters and publish the current configuration', async () => {
    const { result } = renderHook(() => useConfiguration())

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    await act(async () => {
      await result.current.onModelChange({
        features: ['vision'],
        mode: ModelModeType.chat,
        modelId: 'gpt-4.1',
        provider: 'langgenius/openai/openai',
      })
    })

    expect(mockFetchAndMergeValidCompletionParams).toHaveBeenCalledWith(
      'langgenius/openai/openai',
      'gpt-4.1',
      { temperature: 0.7 },
      true,
    )
    expect(result.current.appPublisherProps.onPublish).toBeDefined()

    await act(async () => {
      await result.current.appPublisherProps.onPublish!(undefined, result.current.featuresData)
    })

    expect(updateAppModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      url: '/apps/app-1/model-config',
    }))
  })

  it('should expose derived feature flags and imperative callbacks', async () => {
    mockCurrentModelFeatures = ['vision', 'document', 'audio', 'video']
    mockFetchAppDetailDirect.mockResolvedValueOnce({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: {
        prompt_type: 'simple',
        chat_prompt_config: { prompt: [] },
        completion_prompt_config: {
          prompt: { text: 'completion' },
          conversation_histories_role: {
            assistant_prefix: 'assistant',
            user_prefix: 'user',
          },
        },
        dataset_configs: { datasets: { datasets: [] } },
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.chat,
          completion_params: { temperature: 0.7 },
        },
        user_input_form: [],
        pre_prompt: 'hello {{name}}',
        opening_statement: 'intro',
        suggested_questions: [],
        more_like_this: { enabled: false },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false, voice: '', language: '' },
        retriever_resource: { enabled: false },
        annotation_reply: {
          enabled: true,
          id: 'annotation-1',
          score_threshold: 0.6,
          embedding_model: {
            embedding_provider_name: 'langgenius/openai/openai',
            embedding_model_name: 'text-embedding-3-small',
          },
        },
        sensitive_word_avoidance: { enabled: false },
        external_data_tools: [],
        file_upload: {
          image: {
            enabled: true,
            number_limits: 1,
            detail: 'low',
            transfer_methods: ['local_file'],
          },
        },
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      },
    })

    const { result } = renderHook(() => useConfiguration())

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.contextValue.isShowVisionConfig).toBe(true)
    expect(result.current.contextValue.isShowDocumentConfig).toBe(true)
    expect(result.current.contextValue.isShowAudioConfig).toBe(true)
    expect(result.current.contextValue.isAllowVideoUpload).toBe(true)

    await act(async () => {
      await result.current.contextValue.setPromptMode('advanced' as any)
    })
    expect(mockMigrateToDefaultPrompt).toHaveBeenCalled()

    act(() => {
      result.current.onFeaturesChange(undefined as never)
      result.current.onFeaturesChange({ moreLikeThis: { enabled: true } } as never)
      result.current.onAutoAddPromptVariable([{ key: 'city', name: 'City', type: 'string', required: true } as never])
      result.current.onAgentSettingChange({ enabled: true, max_iteration: 5, strategy: 'react', tools: [] } as never)
      result.current.onEnableMultipleModelDebug()
      result.current.setShowUseGPT4Confirm(true)
      result.current.onConfirmUseGPT4()
      result.current.onOpenAccountSettings()
      result.current.onSaveHistory({
        assistant_prefix: 'bot',
        user_prefix: 'user',
      })
    })

    expect(mockSetShowAppConfigureFeaturesModal).toHaveBeenCalledWith(true)
    expect(mockFormattingChangedDispatcher).toHaveBeenCalled()
    expect(mockHandleMultipleModelConfigsChange).toHaveBeenCalled()
    expect(mockSetAppSidebarExpand).toHaveBeenCalledWith('collapse')
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: 'provider' })
    expect(mockSetConversationHistoriesRole).toHaveBeenCalledWith({
      assistant_prefix: 'bot',
      user_prefix: 'user',
    })
    expect(result.current.showUseGPT4Confirm).toBe(false)

    act(() => {
      result.current.appPublisherProps.resetAppConfig?.()
    })
  })

  it('should preserve temporary stops, dataset selections, and manual formatting changes', async () => {
    mockCurrentModelFeatures = ['vision']
    mockCurrentModelMode = ModelModeType.completion
    mockFetchDatasets.mockResolvedValueOnce({
      data: [{ id: 'dataset-1', name: 'Dataset One' }],
    })
    mockFetchAppDetailDirect.mockResolvedValueOnce({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: {
        prompt_type: 'simple',
        chat_prompt_config: { prompt: [] },
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
        dataset_query_variable: 'context',
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o',
          mode: ModelModeType.completion,
          completion_params: { temperature: 0.7 },
        },
        user_input_form: [
          {
            text_input: {
              variable: 'context',
              label: 'Context',
              required: false,
            },
          },
        ],
        pre_prompt: '',
        opening_statement: 'intro',
        suggested_questions: [],
        more_like_this: { enabled: false },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false, voice: '', language: '' },
        retriever_resource: { enabled: false },
        annotation_reply: null,
        sensitive_word_avoidance: { enabled: false },
        external_data_tools: [],
        file_upload: null,
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      },
    })

    const { result } = renderHook(() => useConfiguration())

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.selectedIds).toEqual(['dataset-1'])
    expect(result.current.contextValue.canReturnToSimpleMode).toBe(true)

    act(() => {
      latestAdvancedPromptConfigOptions?.onUserChangedPrompt?.()
      latestAdvancedPromptConfigOptions?.setStop?.(['END'])
      result.current.contextValue.setAnnotationConfig({
        id: 'annotation-1',
        enabled: true,
        score_threshold: 0.6,
        embedding_model: {
          embedding_provider_name: 'langgenius/openai/openai',
          embedding_model_name: 'text-embedding-3-small',
        },
      })
      result.current.contextValue.setVisionConfig({
        enabled: true,
        number_limits: 2,
        detail: 'high',
        transfer_methods: ['local_file'],
      } as any)
      result.current.contextValue.setCompletionParams({ temperature: 0.2 })
      result.current.onCloseFeaturePanel()
    })

    await waitFor(() => {
      expect(result.current.contextValue.completionParams).toEqual({
        stop: ['END'],
        temperature: 0.2,
      })
    })

    expect(result.current.contextValue.annotationConfig.id).toBe('annotation-1')
    expect(result.current.contextValue.visionConfig.enabled).toBe(true)
    expect(result.current.contextValue.canReturnToSimpleMode).toBe(false)
    expect(mockFormattingChangedDispatcher).toHaveBeenCalledTimes(2)
    expect(mockSetShowAppConfigureFeaturesModal).toHaveBeenCalledWith(false)
  })
})
