import type { Mock } from 'vite-plus/test'
import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  DefaultModelResponse,
  Model,
  ModelProvider,
} from '../declarations'
import { act, renderHook } from '@testing-library/react'
import { useLocale } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { fetchDefaultModal } from '@/service/common'
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
  useModelList,
  useModelListAndDefaultModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useModelModalHandler,
  useRefreshModel,
  useSystemDefaultModelAndModelList,
  useTextGenerationCurrentProviderAndModelAndModelList,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

// Mock dependencies
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

vi.mock('@/service/common', () => ({
  fetchDefaultModal: vi.fn(),
  fetchModelList: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  commonQueryKeys: {
    modelProviders: ['model-providers'],
    modelProviderDetails: ['model-provider-details'],
    defaultModel: (type: string) => ['default-model', type],
  },
}))

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

vi.mock('../atoms', () => ({
  useExpandModelProviderList: vi.fn(() => vi.fn()),
}))

const { useQuery, useQueryClient } = await import('@tanstack/react-query')
const { useModalContextSelector } = await import('@/context/modal-context')
const { useMarketplacePlugins, useMarketplacePluginsByCollectionId } =
  await import('@/app/components/plugins/marketplace/hooks')
const { useExpandModelProviderList } = await import('../atoms')

const getModelListQueryKey = (modelType: ModelTypeEnum) =>
  consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
    input: {
      params: {
        model_type: modelType,
      },
    },
  })

describe('hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useLanguage', () => {
    it('should replace hyphen with underscore in locale', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('en_US')
    })

    it('should return locale as is if no hyphen exists', () => {
      ;(useLocale as Mock).mockReturnValue('enUS')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('enUS')
    })

    it('should handle Chinese locale', () => {
      ;(useLocale as Mock).mockReturnValue('zh-Hans')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('zh_Hans')
    })

    it('should only replace the first hyphen when multiple exist', () => {
      ;(useLocale as Mock).mockReturnValue('en-GB-custom')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('en_GB-custom')
    })
  })

  describe('useSystemDefaultModelAndModelList', () => {
    const createMockModelList = (): Model[] => [
      {
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

    const createMockDefaultModel = (model = 'gpt-3.5-turbo'): DefaultModelResponse => ({
      provider: {
        provider: 'openai',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
      },
      model,
      model_type: ModelTypeEnum.textGeneration,
    })

    it('should return default model state when model exists', () => {
      const defaultModel = createMockDefaultModel()
      const modelList = createMockModelList()
      const { result } = renderHook(() =>
        useSystemDefaultModelAndModelList(defaultModel, modelList),
      )

      expect(result.current[0]).toEqual({ model: 'gpt-3.5-turbo', provider: 'openai' })
    })

    it('should return undefined when default model is undefined', () => {
      const modelList = createMockModelList()
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(undefined, modelList))

      expect(result.current[0]).toBeUndefined()
    })

    it('should return undefined when provider not found in model list', () => {
      const defaultModel = {
        provider: {
          provider: 'anthropic',
          icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        },
        model: 'claude-3',
        model_type: ModelTypeEnum.textGeneration,
      } as DefaultModelResponse
      const modelList = createMockModelList()
      const { result } = renderHook(() =>
        useSystemDefaultModelAndModelList(defaultModel, modelList),
      )

      expect(result.current[0]).toBeUndefined()
    })

    it('should return undefined when model not found in provider', () => {
      const defaultModel = createMockDefaultModel('gpt-5')
      const modelList = createMockModelList()
      const { result } = renderHook(() =>
        useSystemDefaultModelAndModelList(defaultModel, modelList),
      )

      expect(result.current[0]).toBeUndefined()
    })

    it('should update default model state', () => {
      const defaultModel = createMockDefaultModel()
      const modelList = createMockModelList()
      const { result } = renderHook(() =>
        useSystemDefaultModelAndModelList(defaultModel, modelList),
      )

      const newModel = { model: 'gpt-4', provider: 'openai' }
      act(() => {
        result.current[1](newModel)
      })

      expect(result.current[0]).toEqual(newModel)
    })

    it('should update state when defaultModel prop changes', () => {
      const defaultModel = createMockDefaultModel()
      const modelList = createMockModelList()
      const { result, rerender } = renderHook(
        ({ defaultModel, modelList }) => useSystemDefaultModelAndModelList(defaultModel, modelList),
        { initialProps: { defaultModel, modelList } },
      )

      expect(result.current[0]).toEqual({ model: 'gpt-3.5-turbo', provider: 'openai' })

      const newDefaultModel = createMockDefaultModel('gpt-4')
      rerender({ defaultModel: newDefaultModel, modelList })

      expect(result.current[0]).toEqual({ model: 'gpt-4', provider: 'openai' })
    })

    it('should handle empty model list', () => {
      const defaultModel = createMockDefaultModel()
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(defaultModel, []))

      expect(result.current[0]).toBeUndefined()
    })
  })

  describe('useModelList', () => {
    const mockModelData = [
      { provider: 'openai', models: [{ model: 'gpt-4' }] },
      { provider: 'anthropic', models: [{ model: 'claude-3' }] },
    ]

    it('should use the generated model list key and expose the result', () => {
      const refetch = vi.fn()
      ;(useQuery as Mock).mockReturnValue({
        data: { data: mockModelData },
        isPending: false,
        refetch,
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      expect(result.current.data).toEqual(mockModelData)
      expect(result.current.isLoading).toBe(false)
      expect(useQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: getModelListQueryKey(ModelTypeEnum.textGeneration),
        }),
      )
    })

    it('should return empty array when data is undefined', () => {
      ;(useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: false,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      expect(result.current.data).toEqual([])
    })

    it('should keep the query disabled when requested', () => {
      ;(useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: true,
        refetch: vi.fn(),
      })

      renderHook(() => useModelList(ModelTypeEnum.textEmbedding, { enabled: false }))

      expect(useQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
          queryKey: getModelListQueryKey(ModelTypeEnum.textEmbedding),
        }),
      )
    })

    it('should handle loading state', () => {
      ;(useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: true,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      expect(result.current.isLoading).toBe(true)
    })

    it('should call mutate to refetch data', () => {
      const refetch = vi.fn()
      ;(useQuery as Mock).mockReturnValue({
        data: { data: mockModelData },
        isPending: false,
        refetch,
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      act(() => {
        result.current.mutate()
      })

      expect(refetch).toHaveBeenCalled()
    })

    it('should work with different model types', () => {
      ;(useQuery as Mock).mockReturnValue({
        data: { data: [] },
        isPending: false,
        refetch: vi.fn(),
      })

      const { result: result1 } = renderHook(() => useModelList(ModelTypeEnum.textEmbedding))
      const { result: result2 } = renderHook(() => useModelList(ModelTypeEnum.rerank))
      const { result: result3 } = renderHook(() => useModelList(ModelTypeEnum.tts))

      expect(result1.current.data).toEqual([])
      expect(result2.current.data).toEqual([])
      expect(result3.current.data).toEqual([])
    })
  })

  describe('useDefaultModel', () => {
    const mockDefaultModel = {
      model: 'gpt-4',
      model_type: ModelTypeEnum.textGeneration,
      provider: { provider: 'openai', icon_small: { en_US: 'icon', zh_Hans: 'icon' } },
    }

    it('should fetch default model successfully', async () => {
      const refetch = vi.fn()
      ;(useQuery as Mock).mockReturnValue({
        data: { data: mockDefaultModel },
        isPending: false,
        refetch,
      })

      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.data).toEqual(mockDefaultModel)
      expect(result.current.isLoading).toBe(false)

      // Coverage for queryFn
      const queryCall = (useQuery as Mock).mock.calls.find(
        (call) => Array.isArray(call[0].queryKey) && call[0].queryKey[0] === 'default-model',
      )
      if (queryCall) {
        await queryCall[0].queryFn()
        expect(fetchDefaultModal).toHaveBeenCalled()
      }
    })

    it('should return undefined when data is not available', () => {
      ;(useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: false,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.data).toBeUndefined()
    })

    it('should handle loading state', () => {
      ;(useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: true,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.isLoading).toBe(true)
    })

    it('should call mutate to refetch data', () => {
      const refetch = vi.fn()
      ;(useQuery as Mock).mockReturnValue({
        data: { data: mockDefaultModel },
        isPending: false,
        refetch,
      })

      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))

      act(() => {
        result.current.mutate()
      })

      expect(refetch).toHaveBeenCalled()
    })
  })

  describe('getCurrentProviderAndModel', () => {
    const createModelList = (): Model[] => [
      {
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

      const { result } = renderHook(() => getCurrentProviderAndModel(modelList, defaultModel))

      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should return undefined when provider not found', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'anthropic', model: 'claude-3' }

      const { result } = renderHook(() => getCurrentProviderAndModel(modelList, defaultModel))

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })

    it('should return undefined when model not found', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'openai', model: 'gpt-5' }

      const { result } = renderHook(() => getCurrentProviderAndModel(modelList, defaultModel))

      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel).toBeUndefined()
    })

    it('should handle undefined default model', () => {
      const modelList = createModelList()

      const { result } = renderHook(() => getCurrentProviderAndModel(modelList, undefined))

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })

    it('should handle empty model list', () => {
      const defaultModel = { provider: 'openai', model: 'gpt-4' }

      const { result } = renderHook(() => getCurrentProviderAndModel([], defaultModel))

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })
  })

  describe('useTextGenerationCurrentProviderAndModelAndModelList', () => {
    const createModelList = (): Model[] => [
      {
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
        provider: 'anthropic',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' },
        models: [
          {
            model: 'claude-3',
            label: { en_US: 'Claude 3', zh_Hans: 'Claude 3' },
            model_type: ModelTypeEnum.textGeneration,
            fetch_from: ConfigurationMethodEnum.predefinedModel,
            status: ModelStatusEnum.disabled,
            model_properties: {},
            load_balancing_enabled: false,
          },
        ],
        status: ModelStatusEnum.disabled,
      },
    ]

    it('should return all text generation model lists', () => {
      const modelList = createModelList()
      ;(useQuery as Mock).mockReturnValue({
        data: { data: modelList },
        isPending: false,
        refetch: vi.fn(),
      })

      const defaultModel = { provider: 'openai', model: 'gpt-4' }
      const { result } = renderHook(() =>
        useTextGenerationCurrentProviderAndModelAndModelList(defaultModel),
      )

      expect(result.current.textGenerationModelList).toEqual(modelList)
      expect(result.current.activeTextGenerationModelList).toHaveLength(1)
      expect(result.current.activeTextGenerationModelList[0]!.provider).toBe('openai')
    })

    it('should filter active models correctly', () => {
      const modelList = createModelList()
      ;(useQuery as Mock).mockReturnValue({
        data: { data: modelList },
        isPending: false,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useTextGenerationCurrentProviderAndModelAndModelList())

      expect(result.current.activeTextGenerationModelList).toHaveLength(1)
      expect(result.current.activeTextGenerationModelList[0]!.status).toBe(ModelStatusEnum.active)
    })

    it('should find current provider and model', () => {
      const modelList = createModelList()
      ;(useQuery as Mock).mockReturnValue({
        data: { data: modelList },
        isPending: false,
        refetch: vi.fn(),
      })

      const defaultModel = { provider: 'openai', model: 'gpt-4' }
      const { result } = renderHook(() =>
        useTextGenerationCurrentProviderAndModelAndModelList(defaultModel),
      )

      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should handle empty model list', () => {
      ;(useQuery as Mock).mockReturnValue({
        data: { data: [] },
        isPending: false,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useTextGenerationCurrentProviderAndModelAndModelList())

      expect(result.current.textGenerationModelList).toEqual([])
      expect(result.current.activeTextGenerationModelList).toEqual([])
    })
  })

  describe('useModelListAndDefaultModel', () => {
    it('should return both model list and default model', () => {
      const mockModelData = [{ provider: 'openai', models: [] }]
      const mockDefaultModel = { model: 'gpt-4', provider: { provider: 'openai' } }
      ;(useQuery as Mock)
        .mockReturnValueOnce({ data: { data: mockModelData }, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({
          data: { data: mockDefaultModel },
          isPending: false,
          refetch: vi.fn(),
        })

      const { result } = renderHook(() => useModelListAndDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.modelList).toEqual(mockModelData)
      expect(result.current.defaultModel).toEqual(mockDefaultModel)
    })

    it('should handle undefined values', () => {
      ;(useQuery as Mock)
        .mockReturnValueOnce({ data: undefined, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({ data: undefined, isPending: false, refetch: vi.fn() })

      const { result } = renderHook(() => useModelListAndDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.modelList).toEqual([])
      expect(result.current.defaultModel).toBeUndefined()
    })
  })

  describe('useModelListAndDefaultModelAndCurrentProviderAndModel', () => {
    it('should return complete data structure', () => {
      const mockModelData = [
        {
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
        provider: { provider: 'openai', icon_small: { en_US: 'icon', zh_Hans: 'icon' } },
      }
      ;(useQuery as Mock)
        .mockReturnValueOnce({ data: { data: mockModelData }, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({
          data: { data: mockDefaultModel },
          isPending: false,
          refetch: vi.fn(),
        })

      const { result } = renderHook(() =>
        useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration),
      )

      expect(result.current.modelList).toEqual(mockModelData)
      expect(result.current.defaultModel).toEqual(mockDefaultModel)
      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should handle missing default model', () => {
      const mockModelData = [
        {
          provider: 'openai',
          models: [],
          status: ModelStatusEnum.active,
        },
      ]
      ;(useQuery as Mock)
        .mockReturnValueOnce({ data: { data: mockModelData }, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({ data: undefined, isPending: false, refetch: vi.fn() })

      const { result } = renderHook(() =>
        useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration),
      )

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })
  })

  describe('useUpdateModelList', () => {
    it('should invalidate model list queries', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelList())

      act(() => {
        result.current(ModelTypeEnum.textGeneration)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getModelListQueryKey(ModelTypeEnum.textGeneration),
      })
    })

    it('should handle multiple model types', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelList())

      act(() => {
        result.current(ModelTypeEnum.textGeneration)
        result.current(ModelTypeEnum.textEmbedding)
        result.current(ModelTypeEnum.rerank)
      })

      expect(invalidateQueries).toHaveBeenCalledTimes(3)
    })
  })

  describe('useInvalidateDefaultModel', () => {
    it('should invalidate default model queries', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useInvalidateDefaultModel())

      act(() => {
        result.current(ModelTypeEnum.textGeneration)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['default-model', ModelTypeEnum.textGeneration],
      })
    })

    it('should handle multiple model types', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useInvalidateDefaultModel())

      act(() => {
        result.current(ModelTypeEnum.textGeneration)
        result.current(ModelTypeEnum.textEmbedding)
        result.current(ModelTypeEnum.rerank)
      })

      expect(invalidateQueries).toHaveBeenCalledTimes(3)
    })
  })

  describe('useUpdateModelProviders', () => {
    it('should invalidate model providers queries', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelProviders())

      act(() => {
        result.current()
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-provider-details'],
      })
    })

    it('should be callable multiple times', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelProviders())

      act(() => {
        result.current()
        result.current()
        result.current()
      })

      expect(invalidateQueries).toHaveBeenCalledTimes(6)
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

      expect(queryPluginsWithDebounced).toHaveBeenCalled()
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

      expect(result.current.plugins).toBeDefined()
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

    it('should refresh providers and model lists', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const provider = createMockProvider()
      const modelProviderModelListQueryKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: {
            params: {
              provider: provider.provider,
            },
          },
        })
      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: modelProviderModelListQueryKey,
        exact: true,
        refetchType: 'none',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-provider-details'],
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getModelListQueryKey(ModelTypeEnum.textGeneration),
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getModelListQueryKey(ModelTypeEnum.textEmbedding),
      })
    })

    it('should expand target provider list when refreshModelList is true and custom config is active', () => {
      const invalidateQueries = vi.fn()
      const expandModelProviderList = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ;(useExpandModelProviderList as Mock).mockReturnValue(expandModelProviderList)

      const provider = createMockProvider()
      const customFields: CustomConfigurationModelFixedFields = {
        __model_name: 'gpt-4',
        __model_type: ModelTypeEnum.textGeneration,
      }
      const modelProviderModelListQueryKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: {
            params: {
              provider: provider.provider,
            },
          },
        })

      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider, customFields, true)
      })

      expect(expandModelProviderList).toHaveBeenCalledWith('openai')
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: modelProviderModelListQueryKey,
        exact: true,
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getModelListQueryKey(ModelTypeEnum.textGeneration),
      })
    })

    it('should not expand provider list when custom config is not active', () => {
      const invalidateQueries = vi.fn()
      const expandModelProviderList = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ;(useExpandModelProviderList as Mock).mockReturnValue(expandModelProviderList)

      const provider = {
        ...createMockProvider(),
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      }
      const modelProviderModelListQueryKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: {
            params: {
              provider: provider.provider,
            },
          },
        })

      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider, undefined, true)
      })

      expect(expandModelProviderList).not.toHaveBeenCalled()
      expect(invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: modelProviderModelListQueryKey,
        exact: true,
        refetchType: 'active',
      })
    })

    it('should refetch active model provider list when custom refresh callback is absent', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const provider = createMockProvider()
      const modelProviderModelListQueryKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: {
            params: {
              provider: provider.provider,
            },
          },
        })
      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider, undefined, true)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: modelProviderModelListQueryKey,
        exact: true,
        refetchType: 'active',
      })
    })

    it('should invalidate all supported model types when __model_type is undefined', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const provider = createMockProvider()
      const customFields = {
        __model_name: 'my-model',
        __model_type: undefined,
      } as unknown as CustomConfigurationModelFixedFields

      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider, customFields, true)
      })

      provider.supported_model_types.forEach((modelType) => {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: getModelListQueryKey(modelType),
        })
      })
    })

    it('should handle provider with single model type', () => {
      const invalidateQueries = vi.fn()
      ;(useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const provider = {
        ...createMockProvider(),
        supported_model_types: [ModelTypeEnum.textGeneration],
      }

      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-provider-details'],
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getModelListQueryKey(ModelTypeEnum.textGeneration),
      })
      expect(invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: getModelListQueryKey(ModelTypeEnum.textEmbedding),
      })
    })
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
    })

    it('should call onUpdate callback when modal is saved', () => {
      const setShowModelModal = vi.fn()
      ;(useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()
      const onUpdate = vi.fn()

      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(provider, ConfigurationMethodEnum.predefinedModel, undefined, { onUpdate })
      })

      const callArgs = setShowModelModal.mock.calls[0]![0]
      const newPayload = { test: 'data' }
      const formValues = { field: 'value' }

      act(() => {
        callArgs.onSaveCallback(newPayload, formValues)
      })

      expect(onUpdate).toHaveBeenCalledWith(newPayload, formValues)
    })

    it('should handle modal without onUpdate callback', () => {
      const setShowModelModal = vi.fn()
      ;(useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()

      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(provider, ConfigurationMethodEnum.predefinedModel)
      })

      const callArgs = setShowModelModal.mock.calls[0]![0]

      // Should not throw when onUpdate is not provided
      expect(() => {
        callArgs.onSaveCallback({ test: 'data' }, { field: 'value' })
      }).not.toThrow()
    })
  })
})
