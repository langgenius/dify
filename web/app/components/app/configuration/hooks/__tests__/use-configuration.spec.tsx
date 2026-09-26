import { act, screen, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import CommonLayoutError from '@/app/(commonLayout)/error'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '@/app/components/detail-sidebar/cookie'
import { consoleClient, consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { renderHook as renderHookWithConsoleState } from '@/test/console/render'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import { useConfiguration } from '../use-configuration'

const renderHook = (callback: () => ReturnType<typeof useConfiguration>) => {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  return {
    ...renderHookWithConsoleState(callback, {
      wrapper: createQueryClientWrapper(queryClient),
    }),
    queryClient,
  }
}

const mockSetSettingsDestination = vi.fn()
const mockHandleMultipleModelConfigsChange = vi.fn()
const mockFetchCollectionList = vi.fn()
const mockFetchAppDetailDirect = vi.fn()
const mockUpdateModelConfig = vi.hoisted(() => vi.fn())
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

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      appDetail: {
        id: 'app-1',
        model_config: createAppModelConfigFixture({
          updated_at: 1710000000,
        }),
        mode: AppModeEnum.CHAT,
        permission_keys: mockAppPermissionKeys,
      },
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
          get: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
          modelConfig: { post: mockUpdateModelConfig },
        },
      },
    },
  }
})

vi.mock('@/service/datasets', () => ({
  fetchDatasets: (...args: unknown[]) => mockFetchDatasets(...args),
}))

vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: (...args: unknown[]) =>
    mockFetchAndMergeValidCompletionParams(...args),
}))

describe('useConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME)
    latestAdvancedPromptConfigOptions = undefined
    mockTempStopState = []
    mockCurrentModelFeatures = ['vision']
    mockCurrentModelMode = ModelModeType.chat
    mockAppPermissionKeys = [AppACLPermission.Edit, AppACLPermission.ReleaseAndVersion]
    mockFetchCollectionList.mockResolvedValue([])
    mockFetchDatasets.mockResolvedValue({ data: [] })
    mockFetchAndMergeValidCompletionParams.mockResolvedValue({
      params: { temperature: 0.3 },
      removedDetails: {},
    })
    vi.mocked(consoleClient.apps.byAppId.modelConfig.post).mockResolvedValue(undefined as never)
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
    const { result } = renderHook(() => useConfiguration())
    await waitFor(() => expect(result.current.showLoading).toBe(false))
    expect(result.current.showAppConfigureFeaturesModal).toBe(false)
    act(() => result.current.contextValue.onOpenFeatures())
    expect(result.current.showAppConfigureFeaturesModal).toBe(true)
    act(() => result.current.onCloseFeaturePanel())
    expect(result.current.showAppConfigureFeaturesModal).toBe(false)
    act(() => result.current.contextValue.onOpenFeatures())
    expect(result.current.showAppConfigureFeaturesModal).toBe(true)
  })

  it('should leave loading through the error boundary when the app has no model configuration', async () => {
    mockFetchAppDetailDirect.mockResolvedValueOnce(createAppDetailFixture({ model_config: null }))
    const queryClient = createTestQueryClient()
    seedAccountProfileQuery(queryClient, { id: 'user-1' })
    const QueryWrapper = createQueryClientWrapper(queryClient)
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderHookWithConsoleState(() => useConfiguration(), {
        wrapper: ({ children }) => (
          <QueryWrapper>
            <ErrorBoundary fallback={(error) => <div role="alert">{error.message}</div>}>
              {children}
            </ErrorBoundary>
          </QueryWrapper>
        ),
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'App app-1 has no model configuration',
      )
    } finally {
      report.mockRestore()
    }
  })

  it('should retain the legacy unauthorized response for the redirect loading fallback', async () => {
    const response = new Response(null, { status: 401 })
    mockFetchCollectionList.mockRejectedValueOnce(response)
    const queryClient = createTestQueryClient()
    seedAccountProfileQuery(queryClient, { id: 'user-1' })
    const QueryWrapper = createQueryClientWrapper(queryClient)
    const onError = vi.fn()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderHookWithConsoleState(() => useConfiguration(), {
        wrapper: ({ children }) => (
          <QueryWrapper>
            <ErrorBoundary
              onError={onError}
              fallback={(error) => <CommonLayoutError error={error} retry={vi.fn()} />}
            >
              {children}
            </ErrorBoundary>
          </QueryWrapper>
        ),
      })
      await waitFor(() => expect(onError).toHaveBeenCalledWith(response, expect.anything()))
      expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    } finally {
      report.mockRestore()
    }
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
    const { result, queryClient } = renderHook(() => useConfiguration())
    const detailQueryKey = consoleQuery.apps.byAppId.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    })
    queryClient.setQueryData(
      detailQueryKey,
      createAppDetailFixture({
        enable_api: false,
        enable_site: false,
        icon_url: null,
        id: 'app-1',
        mode: 'chat',
        name: 'Cached app',
      }),
    )

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
    expect(queryClient.getQueryState(detailQueryKey)?.isInvalidated).toBe(true)
  })

  it('should publish and restore the complete configuration snapshot', async () => {
    const { result } = renderHook(() => useConfiguration())

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
    const { result } = renderHook(() => useConfiguration())

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
    const { result } = renderHook(() => useConfiguration())

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
    const { result } = renderHook(() => useConfiguration())

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

  it('should sync the selected multiple-model config after publishing', async () => {
    const { result } = renderHook(() => useConfiguration())

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

    expect(result.current.contextValue.modelConfig.model_id).toBe('gpt-4.1')
    expect(result.current.contextValue.modelConfig.provider).toBe('langgenius/openai/openai')
    expect(result.current.contextValue.completionParams).toEqual({ temperature: 0.2 })
    expect(result.current.appPublisherProps.publishedConfig.modelConfig.model_id).toBe('gpt-4.1')
  })

  it('should expose the latest published time supplied by the app detail', async () => {
    const { result } = renderHook(() => useConfiguration())

    await waitFor(() => {
      expect(result.current.showLoading).toBe(false)
    })

    expect(result.current.appPublisherProps.publishedAt).toBe(1710000000000)
  })

  it('should block publishing when app release permission is missing', async () => {
    mockAppPermissionKeys = [AppACLPermission.ViewLayout]

    const { result } = renderHook(() => useConfiguration())

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

    const { result } = renderHook(() => useConfiguration())

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

    const { result } = renderHook(() => useConfiguration())

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

    const { result } = renderHook(() => useConfiguration())

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
    mockFetchAppDetailDirect.mockResolvedValueOnce({
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
    mockFetchDatasets.mockResolvedValueOnce({
      data: [{ id: 'dataset-1', name: 'Dataset One' }],
    })
    mockFetchAppDetailDirect.mockResolvedValueOnce({
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
    expect(result.current.showAppConfigureFeaturesModal).toBe(false)
  })
})
