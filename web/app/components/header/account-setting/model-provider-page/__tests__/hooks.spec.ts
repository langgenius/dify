import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { RenderHookOptions } from '@testing-library/react'
import type { Mock } from 'vite-plus/test'
import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  DefaultModelResponse,
  ModelProvider,
} from '../declarations'
import { zModelWithProviderEntityResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { QueryObserver } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { useLocale } from '#i18n'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useModelProviderListExpanded } from '../atoms'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelModalModeEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../declarations'
import {
  getCurrentProviderAndModel,
  useDefaultModel,
  useInvalidateDefaultModel,
  useLanguage,
  useMarketplaceAllPlugins,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useModelModalHandler,
  useRefreshModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'en-US'),
}))

// Mock dependencies

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: vi.fn((selector) => {
    const state = { setShowModelModal: vi.fn() }
    return selector(state)
  }),
}))

vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(() => ({
    plugins: [],
    queryPlugins: vi.fn(),
    queryPluginsWithDebounced: vi.fn(),
    isLoading: false,
  })),
  useMarketplacePluginsByCollectionId: vi.fn(() => ({
    plugins: [],
    isLoading: false,
  })),
}))

const { getDefaultModel, getModels } = vi.hoisted(() => ({
  getDefaultModel: vi.fn(),
  getModels: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.defaultModel.get': getDefaultModel,
      'workspaces.current.models.modelTypes.byModelType.get': getModels,
    }),
  }
})
let queryClient = createConsoleQueryClient()
function renderHook<Result, Props = void>(
  callback: (props: Props) => Result,
  options: Omit<RenderHookOptions<Props>, 'wrapper'> = {},
) {
  return renderHookWithConsoleQuery(callback, { ...options, queryClient })
}
const getModelListQueryKey = (modelType: ModelTypeEnum) =>
  consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
    input: {
      params: {
        model_type: modelType,
      },
    },
  })

const seedModelList = (data: ProviderWithModelsResponse[]) =>
  queryClient.setQueryData<{ data: ProviderWithModelsResponse[] }>(
    getModelListQueryKey(ModelTypeEnum.textGeneration),
    { data },
  )
const seedDefaultModel = (data: DefaultModelResponse) =>
  queryClient.setQueryData<{ data: DefaultModelResponse }>(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: ModelTypeEnum.textGeneration } },
    }),
    { data },
  )
const { useModalContextSelector } = await import('@/context/modal-context')
const { useMarketplacePlugins, useMarketplacePluginsByCollectionId } =
  await import('@/app/components/plugins/marketplace/hooks')

describe('hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLocale).mockReturnValue('en-US')
    ;(useMarketplacePlugins as Mock).mockReturnValue({
      plugins: [],
      queryPlugins: vi.fn(),
      queryPluginsWithDebounced: vi.fn(),
      isLoading: false,
    })
    ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
      plugins: [],
      isLoading: false,
    })
    queryClient = createConsoleQueryClient()
    getDefaultModel.mockReset().mockImplementation(() => new Promise(() => {}))
    getModels.mockReset().mockImplementation(() => new Promise(() => {}))
  })

  describe('useLanguage', () => {
    it('should replace hyphen with underscore in locale', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('en_US')
    })

    it('should handle Chinese locale', () => {
      ;(useLocale as Mock).mockReturnValue('zh-Hans')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('zh_Hans')
    })
  })

  describe('useDefaultModel', () => {
    const defaultModel = {
      model: 'gpt-4',
      model_type: ModelTypeEnum.textGeneration,
      provider: {
        provider: 'openai',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        label: { en_US: 'OpenAI' },
        supported_model_types: [],
        tenant_id: 'tenant-1',
      },
    }
    it('loads the default model and exposes the resolved response', async () => {
      const request = createDeferred<{ data: typeof defaultModel }>()
      getDefaultModel.mockReturnValue(request.promise)
      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))
      expect(result.current.isLoading).toBe(true)
      expect(result.current.data).toBeUndefined()
      await act(async () => request.resolve({ data: defaultModel }))
      await waitFor(() => expect(result.current.data).toEqual(defaultModel))
      expect(result.current.isLoading).toBe(false)
      expect(getDefaultModel).toHaveBeenCalledWith({ query: { model_type: 'llm' } })
    })
    it('does not fetch or show loading when disabled', async () => {
      const { result } = renderHook(() =>
        useDefaultModel(ModelTypeEnum.textEmbedding, { enabled: false }),
      )
      await act(async () => {})
      expect(getDefaultModel).not.toHaveBeenCalled()
      expect(result.current.isLoading).toBe(false)
    })
    it('refreshes a cached default through mutate without returning to initial loading', async () => {
      seedDefaultModel(defaultModel)
      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))
      const request = createDeferred<{ data: typeof defaultModel }>()
      getDefaultModel.mockReturnValue(request.promise)
      act(() => {
        void result.current.mutate()
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.data).toEqual(defaultModel)
      await act(async () => request.resolve({ data: { ...defaultModel, model: 'gpt-5' } }))
      await waitFor(() => expect(result.current.data?.model).toBe('gpt-5'))
    })
    it('represents an unset server default as undefined', async () => {
      getDefaultModel.mockResolvedValue({ data: null })
      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.data).toBeUndefined()
    })
  })

  describe('getCurrentProviderAndModel', () => {
    const createModelList = (): ProviderWithModelsResponse[] => [
      {
        tenant_id: 'test-workspace',
        provider: 'openai',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
        models: [
          {
            model: 'gpt-3.5-turbo',
            label: { en_US: 'GPT-3.5', zh_Hans: 'GPT-3.5' },
            model_type: ModelTypeEnum.textGeneration,
            fetch_from: ConfigurationMethodEnum.predefinedModel,
            status: ModelStatusEnum.active,
            model_properties: {},
            load_balancing_enabled: false,
          },
          {
            model: 'gpt-4',
            label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
            model_type: ModelTypeEnum.textGeneration,
            fetch_from: ConfigurationMethodEnum.predefinedModel,
            status: ModelStatusEnum.active,
            model_properties: {},
            load_balancing_enabled: false,
          },
        ],
        status: ModelStatusEnum.active,
      },
    ]

    it('should find current provider and model', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'openai', model: 'gpt-4' }

      const result = getCurrentProviderAndModel(modelList, defaultModel)

      expect(result.currentProvider?.provider).toBe('openai')
      expect(result.currentModel?.model).toBe('gpt-4')
    })

    it('should return undefined when provider not found', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'anthropic', model: 'claude-3' }

      const result = getCurrentProviderAndModel(modelList, defaultModel)

      expect(result.currentProvider).toBeUndefined()
      expect(result.currentModel).toBeUndefined()
    })

    it('should return undefined when model not found', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'openai', model: 'gpt-5' }

      const result = getCurrentProviderAndModel(modelList, defaultModel)

      expect(result.currentProvider?.provider).toBe('openai')
      expect(result.currentModel).toBeUndefined()
    })

    it('should handle undefined default model', () => {
      const modelList = createModelList()

      const result = getCurrentProviderAndModel(modelList, undefined)

      expect(result.currentProvider).toBeUndefined()
      expect(result.currentModel).toBeUndefined()
    })

    it('should handle empty model list', () => {
      const defaultModel = { provider: 'openai', model: 'gpt-4' }

      const result = getCurrentProviderAndModel([], defaultModel)

      expect(result.currentProvider).toBeUndefined()
      expect(result.currentModel).toBeUndefined()
    })
  })

  describe('useTextGenerationCurrentProviderAndModelAndModelList', () => {
    const createModelList = (): ProviderWithModelsResponse[] => [
      {
        tenant_id: 'test-workspace',
        provider: 'openai',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
        models: [
          {
            model: 'gpt-4',
            label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
            model_type: ModelTypeEnum.textGeneration,
            fetch_from: ConfigurationMethodEnum.predefinedModel,
            status: ModelStatusEnum.active,
            model_properties: {},
            load_balancing_enabled: false,
          },
        ],
        status: ModelStatusEnum.active,
      },
      {
        tenant_id: 'test-workspace',
        provider: 'anthropic',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' },
        models: [
          {
            model: 'claude-3',
            label: { en_US: 'Claude 3', zh_Hans: 'Claude 3' },
            model_type: ModelTypeEnum.textGeneration,
            fetch_from: ConfigurationMethodEnum.predefinedModel,
            status: 'no-configure',
            model_properties: {},
            load_balancing_enabled: false,
          },
        ],
        status: 'no-configure',
      },
    ]

    it('should return all text generation model lists', () => {
      const modelList = createModelList()
      seedModelList(modelList)

      const defaultModel = { provider: 'openai', model: 'gpt-4' }
      const { result } = renderHook(() =>
        useTextGenerationCurrentProviderAndModelAndModelList(defaultModel),
      )

      expect(result.current.textGenerationModelList).toEqual(modelList)
      expect(result.current.activeTextGenerationModelList).toHaveLength(1)
      expect(result.current.activeTextGenerationModelList[0]!.provider).toBe('openai')
    })

    it('should find current provider and model', () => {
      const modelList = createModelList()
      seedModelList(modelList)

      const defaultModel = { provider: 'openai', model: 'gpt-4' }
      const { result } = renderHook(() =>
        useTextGenerationCurrentProviderAndModelAndModelList(defaultModel),
      )

      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should handle empty model list', () => {
      seedModelList([])

      const { result } = renderHook(() => useTextGenerationCurrentProviderAndModelAndModelList())

      expect(result.current.textGenerationModelList).toEqual([])
      expect(result.current.activeTextGenerationModelList).toEqual([])
    })
  })

  describe('useModelListAndDefaultModelAndCurrentProviderAndModel', () => {
    it('should return complete data structure', () => {
      const mockModelData: ProviderWithModelsResponse[] = [
        {
          tenant_id: 'test-workspace',
          provider: 'openai',
          icon_small: { en_US: 'icon', zh_Hans: 'icon' },
          label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
          models: [
            {
              model: 'gpt-4',
              label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
              model_type: ModelTypeEnum.textGeneration,
              fetch_from: ConfigurationMethodEnum.predefinedModel,
              status: ModelStatusEnum.active,
              model_properties: {},
              load_balancing_enabled: false,
            },
          ],
          status: ModelStatusEnum.active,
        },
      ]
      const mockDefaultModel = {
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
        provider: {
          provider: 'openai',
          icon_small: { en_US: 'icon', zh_Hans: 'icon' },
          label: { en_US: 'OpenAI' },
          supported_model_types: [],
          tenant_id: 'tenant-1',
        },
      }
      seedModelList(mockModelData)
      seedDefaultModel(mockDefaultModel)

      const { result } = renderHook(() =>
        useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration),
      )

      expect(result.current.modelList).toEqual(mockModelData)
      expect(result.current.defaultModel).toEqual(mockDefaultModel)
      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should handle missing default model', () => {
      const mockModelData: ProviderWithModelsResponse[] = [
        {
          provider: 'openai',
          models: [],
          tenant_id: 'tenant-1',
          label: { en_US: 'OpenAI' },
          status: ModelStatusEnum.active,
        },
      ]
      seedModelList(mockModelData)

      const { result } = renderHook(() =>
        useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration),
      )

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })
  })

  describe('model cache refresh', () => {
    it.each([
      { name: 'model list', useRefresh: useUpdateModelList, key: getModelListQueryKey },
      {
        name: 'default model',
        useRefresh: useInvalidateDefaultModel,
        key: (type: ModelTypeEnum) =>
          consoleQuery.workspaces.current.defaultModel.get.queryKey({
            input: { query: { model_type: type } },
          }),
      },
    ])('invalidates only the requested $name type', ({ useRefresh, key }) => {
      const selected = key(ModelTypeEnum.textGeneration)
      const unrelated = key(ModelTypeEnum.textEmbedding)
      queryClient.setQueryData(selected, { data: [] })
      queryClient.setQueryData(unrelated, { data: [] })
      const { result } = renderHook(() => useRefresh())
      act(() => result.current(ModelTypeEnum.textGeneration))
      expect(queryClient.getQueryState(selected)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false)
    })

    it('invalidates summary and full provider caches together', () => {
      const summary = consoleQuery.workspaces.current.modelProviders.summary.get.queryKey()
      const providers = consoleQuery.workspaces.current.modelProviders.get.queryKey({ input: {} })
      const unrelated = getModelListQueryKey(ModelTypeEnum.rerank)
      for (const key of [summary, providers, unrelated]) queryClient.setQueryData(key, { data: [] })
      const { result } = renderHook(() => useUpdateModelProviders())
      act(() => result.current())
      expect(queryClient.getQueryState(summary)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(providers)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false)
    })
  })

  describe('useMarketplaceAllPlugins', () => {
    const createMockPlugins = () => [
      { plugin_id: 'plugin1', type: 'plugin' },
      { plugin_id: 'plugin2', type: 'plugin' },
    ]

    it('should combine collection and regular plugins', () => {
      const collectionPlugins = [{ plugin_id: 'collection1', type: 'plugin' }]
      const regularPlugins = createMockPlugins()
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: collectionPlugins,
        isLoading: false,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: regularPlugins,
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('', []))

      expect(result.current.plugins).toHaveLength(3)
      expect(result.current.isLoading).toBe(false)
    })

    it('should exclude installed providers', () => {
      const collectionPlugins = [
        { plugin_id: 'openai', type: 'plugin' },
        { plugin_id: 'other', type: 'plugin' },
      ]
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: collectionPlugins,
        isLoading: false,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [
          { plugin_id: 'openai', type: 'plugin' },
          { plugin_id: 'regular-only', type: 'plugin' },
        ],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('', ['openai']))

      expect(result.current.plugins!).toHaveLength(2)
      expect(result.current.plugins!.map((plugin) => plugin.plugin_id)).toEqual([
        'other',
        'regular-only',
      ])
    })

    it('should use search when searchText is provided', () => {
      const queryPluginsWithDebounced = vi.fn()
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced,
        isLoading: false,
      })
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: false,
      })

      renderHook(() => useMarketplaceAllPlugins('test search', []))

      expect(queryPluginsWithDebounced).toHaveBeenCalledWith({
        query: 'test search',
        category: 'model',
        exclude: [],
        type: 'plugin',
        sort_by: 'install_count',
        sort_order: 'DESC',
      })
    })

    it('should filter out bundle types', () => {
      const plugins = [
        { plugin_id: 'plugin1', type: 'plugin' },
        { plugin_id: 'bundle1', type: 'bundle' },
      ]
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: false,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins,
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('', []))

      expect(result.current.plugins!).toHaveLength(1)
      expect(result.current.plugins![0]!.plugin_id).toBe('plugin1')
    })

    it('should deduplicate plugins that exist in both collections and regular plugins', () => {
      const duplicatePlugin = { plugin_id: 'shared-plugin', type: 'plugin' }
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [duplicatePlugin],
        isLoading: false,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [{ ...duplicatePlugin }, { plugin_id: 'unique-plugin', type: 'plugin' }],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('', []))

      expect(result.current.plugins).toHaveLength(2)
      expect(result.current.plugins!.filter((p) => p.plugin_id === 'shared-plugin')).toHaveLength(1)
    })

    it('should handle loading states', () => {
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: true,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: true,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('', []))

      expect(result.current.isLoading).toBe(true)
    })

    it('should return an empty list when plugin data is unavailable', () => {
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: false,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: undefined,
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('', []))

      expect(result.current.plugins).toEqual([])
      expect(result.current.isLoading).toBe(false)
    })

    it('should return search plugins (not allPlugins) when searchText is truthy', () => {
      const searchPlugins = [{ plugin_id: 'search-result', type: 'plugin' }]
      const collectionPlugins = [{ plugin_id: 'collection-only', type: 'plugin' }]
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: collectionPlugins,
        isLoading: false,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: searchPlugins,
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('openai', []))

      expect(result.current.plugins).toEqual(searchPlugins)
      expect(result.current.plugins?.some((p) => p.plugin_id === 'collection-only')).toBe(false)
    })

    it('should hide installed plugins when a search response is stale', () => {
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: false,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [
          { plugin_id: 'langgenius/openai', type: 'plugin' },
          { plugin_id: 'langgenius/other', type: 'plugin' },
        ],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('openai', ['langgenius/openai']))

      expect(result.current.plugins).toEqual([{ plugin_id: 'langgenius/other', type: 'plugin' }])
    })

    it('should preserve marketplace cache when disabled', () => {
      const queryPlugins = vi.fn()
      const queryPluginsWithDebounced = vi.fn()
      const cancelQueryPluginsWithDebounced = vi.fn()
      const resetPlugins = vi.fn()
      ;(useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [{ plugin_id: 'collection-only', type: 'plugin' }],
        isLoading: true,
      })
      ;(useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [{ plugin_id: 'search-result', type: 'plugin' }],
        queryPlugins,
        queryPluginsWithDebounced,
        cancelQueryPluginsWithDebounced,
        resetPlugins,
        isLoading: true,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins('', [], false))

      expect(useMarketplacePluginsByCollectionId).toHaveBeenCalledWith(undefined)
      expect(queryPlugins).not.toHaveBeenCalled()
      expect(queryPluginsWithDebounced).not.toHaveBeenCalled()
      expect(cancelQueryPluginsWithDebounced).toHaveBeenCalled()
      expect(resetPlugins).not.toHaveBeenCalled()
      expect(useMarketplacePlugins).toHaveBeenCalledWith(false)
      expect(result.current.plugins).toEqual([])
      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('useRefreshModel', () => {
    const createMockProvider = (): ModelProvider => ({
      provider: 'openai',
      label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
      icon_small: { en_US: 'icon', zh_Hans: 'icon' },
      supported_model_types: [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding],
      configurate_methods: [ConfigurationMethodEnum.predefinedModel],
      provider_credential_schema: { credential_form_schemas: [] },
      model_credential_schema: {
        model: {
          label: { en_US: 'Model', zh_Hans: '模型' },
          placeholder: { en_US: 'Select model', zh_Hans: '选择模型' },
        },
        credential_form_schemas: [],
      },
      preferred_provider_type: PreferredProviderTypeEnum.system,
      custom_configuration: {
        status: CustomConfigurationStatusEnum.active,
      },
      system_configuration: {
        enabled: true,
        current_quota_type: CurrentSystemQuotaTypeEnum.trial,
        quota_configurations: [],
      },
      help: {
        title: {
          en_US: '',
          zh_Hans: '',
        },
        url: {
          en_US: '',
          zh_Hans: '',
        },
      },
    })

    it('marks the provider and all supported model caches stale without touching another provider', () => {
      const provider = createMockProvider()
      const providerKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: { params: { provider: 'openai' } },
        })
      const otherProviderKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: { params: { provider: 'anthropic' } },
        })
      const keys = [providerKey, ...provider.supported_model_types.map(getModelListQueryKey)]
      for (const key of [...keys, otherProviderKey]) queryClient.setQueryData(key, { data: [] })
      const { result } = renderHook(() => useRefreshModel())
      act(() => result.current.handleRefreshModel(provider))
      for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(otherProviderKey)?.isInvalidated).toBe(false)
    })

    it.each([
      { refresh: false, active: true, expected: false },
      { refresh: true, active: false, expected: false },
      { refresh: true, active: true, expected: true },
    ])(
      'refetches the visible provider only when configured and requested ($refresh, $active)',
      async ({ refresh, active, expected }) => {
        const provider = createMockProvider()
        provider.custom_configuration.status = active
          ? CustomConfigurationStatusEnum.active
          : CustomConfigurationStatusEnum.noConfigure
        const key = consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: { params: { provider: 'openai' } },
        })
        const model = zModelWithProviderEntityResponse.parse({
          model: 'old',
          model_type: 'llm',
          label: { en_US: 'Model' },
          fetch_from: 'predefined-model',
          model_properties: {},
          status: 'active',
          provider: {
            provider: 'openai',
            label: { en_US: 'OpenAI' },
            tenant_id: 'workspace-1',
            supported_model_types: ['llm'],
          },
        })
        queryClient.setQueryData(key, { data: [model] })
        const updatedModels = { data: [{ ...model, model: 'updated' }] }
        const fetchModels = vi.fn().mockResolvedValue(updatedModels)
        const observer = new QueryObserver(queryClient, {
          queryKey: key,
          queryFn: fetchModels,
          staleTime: Infinity,
        })
        const unsubscribe = observer.subscribe(() => {})
        const { result } = renderHook(() => ({
          ...useRefreshModel(),
          expanded: useModelProviderListExpanded('openai'),
        }))
        await act(async () => result.current.handleRefreshModel(provider, undefined, refresh))
        expect(result.current.expanded).toBe(expected)
        if (expected) {
          await waitFor(() => expect(queryClient.getQueryData(key)).toEqual(updatedModels))
          expect(fetchModels).toHaveBeenCalledTimes(1)
        } else {
          expect(fetchModels).not.toHaveBeenCalled()
          expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        }
        unsubscribe()
      },
    )
  })

  describe('useModelModalHandler', () => {
    const createMockProvider = (): ModelProvider => ({
      provider: 'openai',
      label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
      icon_small: { en_US: 'icon', zh_Hans: 'icon' },
      supported_model_types: [ModelTypeEnum.textGeneration],
      configurate_methods: [ConfigurationMethodEnum.predefinedModel],
      provider_credential_schema: { credential_form_schemas: [] },
      model_credential_schema: {
        model: {
          label: { en_US: 'Model', zh_Hans: '模型' },
          placeholder: { en_US: 'Select model', zh_Hans: '选择模型' },
        },
        credential_form_schemas: [],
      },
      preferred_provider_type: PreferredProviderTypeEnum.system,
      custom_configuration: {
        status: CustomConfigurationStatusEnum.noConfigure,
      },
      system_configuration: {
        enabled: true,
        current_quota_type: CurrentSystemQuotaTypeEnum.trial,
        quota_configurations: [],
      },
      help: {
        title: {
          en_US: '',
          zh_Hans: '',
        },
        url: {
          en_US: '',
          zh_Hans: '',
        },
      },
    })

    it('should open model modal with basic configuration', () => {
      const setShowModelModal = vi.fn()
      ;(useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()
      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(provider, ConfigurationMethodEnum.predefinedModel)
      })

      expect(setShowModelModal).toHaveBeenCalledWith({
        payload: {
          currentProvider: provider,
          currentConfigurationMethod: ConfigurationMethodEnum.predefinedModel,
          currentCustomConfigurationModelFixedFields: undefined,
          isModelCredential: undefined,
          credential: undefined,
          model: undefined,
          mode: undefined,
        },
        onSaveCallback: expect.any(Function),
      })
    })

    it('should open model modal with custom configuration', () => {
      const setShowModelModal = vi.fn()
      ;(useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()
      const customFields: CustomConfigurationModelFixedFields = {
        __model_name: 'gpt-4',
        __model_type: ModelTypeEnum.textGeneration,
      }

      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(provider, ConfigurationMethodEnum.customizableModel, customFields)
      })

      expect(setShowModelModal).toHaveBeenCalledWith({
        payload: {
          currentProvider: provider,
          currentConfigurationMethod: ConfigurationMethodEnum.customizableModel,
          currentCustomConfigurationModelFixedFields: customFields,
          isModelCredential: undefined,
          credential: undefined,
          model: undefined,
          mode: undefined,
        },
        onSaveCallback: expect.any(Function),
      })
    })

    it('should open model modal with extra options', () => {
      const setShowModelModal = vi.fn()
      ;(useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()
      const credential: Credential = { credential_id: 'cred-1' }
      const model: CustomModel = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration }
      const onUpdate = vi.fn()

      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(provider, ConfigurationMethodEnum.predefinedModel, undefined, {
          isModelCredential: true,
          credential,
          model,
          onUpdate,
          mode: ModelModalModeEnum.configProviderCredential,
        })
      })

      expect(setShowModelModal).toHaveBeenCalledWith({
        payload: {
          currentProvider: provider,
          currentConfigurationMethod: ConfigurationMethodEnum.predefinedModel,
          currentCustomConfigurationModelFixedFields: undefined,
          isModelCredential: true,
          credential,
          model,
          mode: ModelModalModeEnum.configProviderCredential,
        },
        onSaveCallback: expect.any(Function),
      })
      const savedPayload = setShowModelModal.mock.calls[0]![0].payload
      act(() =>
        setShowModelModal.mock.calls[0]![0].onSaveCallback(savedPayload, { api_key: 'new-key' }),
      )
      expect(onUpdate).toHaveBeenCalledExactlyOnceWith(savedPayload, { api_key: 'new-key' })
    })
  })
})
