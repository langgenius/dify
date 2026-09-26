import { act, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '@/app/components/detail-sidebar/cookie'
import { consoleClient } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { seedAppDetail } from '@/test/console/query-data'
import { renderHook as renderHookWithConsoleState } from '@/test/console/render'
import { createAppModelConfigFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import { buildConfigurationDefaults } from '../configuration-lifecycle/load'
import { useConfiguration } from '../use-configuration'

const mockSetSettingsDestination = vi.fn()
const mockHandleMultipleModelConfigsChange = vi.fn()
const collectionsFixture = vi.fn()
const appDetailFixture = vi.fn()
const mockUpdateModelConfig = vi.hoisted(() => vi.fn())
const datasetsFixture = vi.fn()
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
let mockAppPermissionKeys: string[] = [AppACLPermission.Edit, AppACLPermission.ReleaseAndVersion]
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

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, mockSetSettingsDestination] }
})

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
  },
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'app-1' }),
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

vi.mock('@/service/console', async () => {
  const actual = await vi.importActual<typeof import('@/service/console')>('@/service/console')
  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      account: actual.consoleQuery.account,
      apps: {
        byAppId: {
          get: actual.consoleQuery.apps.byAppId.get,
          modelConfig: {
            post: {
              mutationOptions: (options: Record<string, unknown>) => ({
                ...options,
                mutationFn: (input: unknown) => mockUpdateModelConfig(input),
              }),
            },
          },
        },
      },
    },
    consoleClient: {
      apps: {
        byAppId: {
          get: (...args: unknown[]) => appDetailFixture(...args),
          modelConfig: { post: mockUpdateModelConfig },
        },
      },
    },
  }
})

vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: (...args: unknown[]) =>
    mockFetchAndMergeValidCompletionParams(...args),
}))

let initialDefaults: Parameters<typeof useConfiguration>[0]

const renderHook = async (callback: () => ReturnType<typeof useConfiguration>) => {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  const detail = seedAppDetail(queryClient, {
    ...(await appDetailFixture()),
    id: 'app-1',
    permission_keys: mockAppPermissionKeys,
  })
  initialDefaults = {
    ...buildConfigurationDefaults({
      response: detail,
      collections: await collectionsFixture(),
      nextDataSets: (await datasetsFixture()).data,
      currentRerankModel: 'rerank-1',
      currentRerankProvider: 'langgenius/cohere/cohere',
    }),
    fileUploadConfigResponse: {
      attachment_image_file_size_limit: 10,
      audio_file_size_limit: 50,
      batch_count_limit: 5,
      file_size_limit: 15,
      file_upload_limit: 5,
      image_file_batch_limit: 10,
      image_file_size_limit: 10,
      knowledge_file_size_limit: 15,
      single_chunk_attachment_limit: 10,
      skill_file_size_limit: 10,
      video_file_size_limit: 100,
      workflow_file_upload_limit: 10,
    },
  }
  return {
    ...renderHookWithConsoleState(callback, {
      wrapper: createQueryClientWrapper(queryClient),
    }),
    queryClient,
  }
}

describe('useConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME)
    latestAdvancedPromptConfigOptions = undefined
    mockTempStopState = []
    mockCurrentModelFeatures = ['vision']
    mockCurrentModelMode = ModelModeType.chat
    mockAppPermissionKeys = [AppACLPermission.Edit, AppACLPermission.ReleaseAndVersion]
    collectionsFixture.mockResolvedValue([])
    datasetsFixture.mockResolvedValue({ data: [] })
    mockFetchAndMergeValidCompletionParams.mockResolvedValue({
      params: { temperature: 0.3 },
      removedDetails: {},
    })
    vi.mocked(consoleClient.apps.byAppId.modelConfig.post).mockResolvedValue(undefined as never)
    appDetailFixture.mockResolvedValue({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: createAppModelConfigFixture({
        updated_at: 1710000000,
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
        annotation_reply: { enabled: false },
        sensitive_word_avoidance: { enabled: false },
        external_data_tools: [],
      }),
    })
  })

  it('opens, closes, and reopens feature configuration within the current session', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))
    await waitFor(() => expect(result.current.showLoading).toBe(false))
    expect(result.current.showAppConfigureFeaturesModal).toBe(false)
    act(() => result.current.contextValue.onOpenFeatures())
    expect(result.current.showAppConfigureFeaturesModal).toBe(true)
    act(() => result.current.onCloseFeaturePanel())
    expect(result.current.showAppConfigureFeaturesModal).toBe(false)
    act(() => result.current.contextValue.onOpenFeatures())
    expect(result.current.showAppConfigureFeaturesModal).toBe(true)
  })

  it('should load configuration state and expose the derived view model', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

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
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

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

    expect(consoleClient.apps.byAppId.modelConfig.post).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-1' },
      }),
    )
  })

  it('should publish and restore the complete configuration snapshot', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    act(() => {
      result.current.contextValue.setDatasetConfigs({
        ...result.current.contextValue.datasetConfigs,
        top_k: 8,
      })
    })

    await act(async () => {
      await result.current.appPublisherProps.onPublish!(undefined, result.current.featuresData)
    })
    expect(result.current.appPublisherProps.publishedConfig.datasetConfigs.top_k).toBe(8)

    act(() => {
      result.current.contextValue.setDatasetConfigs({
        ...result.current.contextValue.datasetConfigs,
        top_k: 10,
      })
    })

    mockSetChatPromptConfig.mockClear()
    mockSetCompletionPromptConfig.mockClear()
    act(() => {
      result.current.appPublisherProps.resetAppConfig?.()
    })
    expect(result.current.contextValue.datasetConfigs.top_k).toBe(8)
    expect(mockSetChatPromptConfig).toHaveBeenCalledWith({
      prompt: [{ role: 'system', text: 'hi' }],
    })
    expect(mockSetCompletionPromptConfig).toHaveBeenCalledWith({
      prompt: { text: 'completion' },
      conversation_histories_role: {
        assistant_prefix: 'assistant',
        user_prefix: 'user',
      },
    })
  })

  it('should enable multiple-model mode', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    act(() => {
      result.current.onEnableMultipleModelDebug()
    })

    expect(mockHandleMultipleModelConfigsChange).toHaveBeenCalledWith(
      true,
      expect.arrayContaining([
        expect.objectContaining({
          model: 'gpt-4o',
          provider: 'langgenius/openai/openai',
        }),
      ]),
    )
  })

  it('should update multiple-model debug configs', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    const modelConfigs = [
      {
        id: 'model-1',
        model: 'gpt-4o',
        provider: 'langgenius/openai/openai',
        parameters: { temperature: 0.7 },
      },
      {
        id: 'model-2',
        model: 'gpt-4.1',
        provider: 'langgenius/openai/openai',
        parameters: {},
      },
      {
        id: 'model-3',
        model: '',
        provider: '',
        parameters: {},
      },
    ]

    act(() => {
      result.current.onMultipleModelConfigsChange(true, modelConfigs)
    })

    expect(mockHandleMultipleModelConfigsChange).toHaveBeenCalledWith(true, modelConfigs)
  })

  it('should keep multiple-model debug state when restoring published config', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    act(() => {
      result.current.onEnableMultipleModelDebug()
    })

    act(() => {
      result.current.contextValue.setDatasetConfigs({
        ...result.current.contextValue.datasetConfigs,
        top_k: 8,
      })
    })

    mockHandleMultipleModelConfigsChange.mockClear()
    act(() => {
      result.current.appPublisherProps.resetAppConfig?.()
    })

    expect(mockHandleMultipleModelConfigsChange).not.toHaveBeenCalled()
  })

  it('should publish the selected multiple-model config without replacing the editor draft', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    act(() => {
      result.current.contextValue.setDatasetConfigs({
        ...result.current.contextValue.datasetConfigs,
        top_k: 8,
      })
    })

    await act(async () => {
      await result.current.appPublisherProps.onPublish!(
        {
          id: 'model-2',
          model: 'gpt-4.1',
          provider: 'langgenius/openai/openai',
          parameters: { temperature: 0.2 },
        },
        result.current.featuresData,
      )
    })

    expect(result.current.contextValue.modelConfig.model_id).toBe('gpt-4o')
    expect(result.current.contextValue.modelConfig.provider).toBe('langgenius/openai/openai')
    expect(result.current.contextValue.completionParams).toEqual({ temperature: 0.7 })
    expect(result.current.appPublisherProps.publishedConfig.modelConfig.model_id).toBe('gpt-4.1')
  })

  it('should expose the latest published time supplied by the app detail', async () => {
    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.appPublisherProps.publishedAt).toBe(1710000000000)
  })

  it('should block publishing when app release permission is missing', async () => {
    mockAppPermissionKeys = [AppACLPermission.ViewLayout]

    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.contextValue.readonly).toBe(true)
    expect(result.current.contextValue.canTestAndRun).toBe(false)
    expect(result.current.appPublisherProps.disabled).toBe(true)
    expect(result.current.appPublisherProps.publishDisabled).toBe(true)

    await act(async () => {
      await result.current.appPublisherProps.onPublish!(undefined, result.current.featuresData)
    })

    expect(consoleClient.apps.byAppId.modelConfig.post).not.toHaveBeenCalled()
  })

  it('should allow test and run while keeping configuration readonly when only app test/run permission exists', async () => {
    mockAppPermissionKeys = [AppACLPermission.TestAndRun]

    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.contextValue.readonly).toBe(true)
    expect(result.current.contextValue.canTestAndRun).toBe(true)
    expect(result.current.appPublisherProps.disabled).toBe(true)
    expect(result.current.appPublisherProps.publishDisabled).toBe(true)

    await act(async () => {
      await result.current.appPublisherProps.onPublish!(undefined, result.current.featuresData)
    })

    expect(consoleClient.apps.byAppId.modelConfig.post).not.toHaveBeenCalled()
  })

  it('should keep configuration editable but block publishing when only app edit permission exists', async () => {
    mockAppPermissionKeys = [AppACLPermission.Edit]

    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.contextValue.readonly).toBe(false)
    expect(result.current.contextValue.canTestAndRun).toBe(false)
    expect(result.current.appPublisherProps.disabled).toBe(true)
    expect(result.current.appPublisherProps.publishDisabled).toBe(true)

    await act(async () => {
      await result.current.appPublisherProps.onPublish!(undefined, result.current.featuresData)
    })

    expect(consoleClient.apps.byAppId.modelConfig.post).not.toHaveBeenCalled()
  })

  it('should allow publishing with app release permission even when configuration is readonly', async () => {
    mockAppPermissionKeys = [AppACLPermission.ReleaseAndVersion]

    const { result } = await renderHook(() => useConfiguration(initialDefaults))

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.contextValue.readonly).toBe(true)
    expect(result.current.contextValue.canTestAndRun).toBe(false)
    expect(result.current.appPublisherProps.disabled).toBe(false)
    expect(result.current.appPublisherProps.publishDisabled).toBe(false)

    await act(async () => {
      await result.current.appPublisherProps.onPublish!(undefined, result.current.featuresData)
    })

    expect(consoleClient.apps.byAppId.modelConfig.post).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-1' },
      }),
    )
  })

  it('should expose derived feature flags and imperative callbacks', async () => {
    mockCurrentModelFeatures = ['vision', 'document', 'audio', 'video']
    appDetailFixture.mockResolvedValueOnce({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: createAppModelConfigFixture({
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
          retrieval_model: 'multiple',
          datasets: { datasets: [] },
        },
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
      }),
    })

    const { result } = await renderHook(() => useConfiguration(initialDefaults))

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
      result.current.onAutoAddPromptVariable([
        { key: 'city', name: 'City', type: 'string', required: true } as never,
      ])
      result.current.onAgentSettingChange({
        enabled: true,
        max_iteration: 5,
        strategy: 'react',
        tools: [],
      } as never)
      result.current.onEnableMultipleModelDebug()
      result.current.setShowUseGPT4Confirm(true)
      result.current.onConfirmUseGPT4()
      result.current.onOpenAccountSettings()
      result.current.onSaveHistory({
        assistant_prefix: 'bot',
        user_prefix: 'user',
      })
    })

    expect(result.current.showAppConfigureFeaturesModal).toBe(true)
    expect(mockFormattingChangedDispatcher).toHaveBeenCalled()
    expect(mockHandleMultipleModelConfigsChange).toHaveBeenCalled()
    expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')
    expect(mockSetSettingsDestination).toHaveBeenCalledWith('provider')
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
    datasetsFixture.mockResolvedValueOnce({
      data: [{ id: 'dataset-1', name: 'Dataset One' }],
    })
    appDetailFixture.mockResolvedValueOnce({
      deleted_tools: [],
      mode: AppModeEnum.CHAT,
      model_config: createAppModelConfigFixture({
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
          retrieval_model: 'multiple',
          datasets: {
            datasets: [{ dataset: { id: 'dataset-1', enabled: true } }],
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
            'text-input': {
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
        annotation_reply: { enabled: false },
        sensitive_word_avoidance: { enabled: false },
        external_data_tools: [],
        file_upload: {},
      }),
    })

    const { result } = await renderHook(() => useConfiguration(initialDefaults))

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
    expect(result.current.showAppConfigureFeaturesModal).toBe(false)
  })
})
