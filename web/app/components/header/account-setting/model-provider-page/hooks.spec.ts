import type { Mock } from 'vitest'
import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  DefaultModelResponse,
  Model,
  ModelProvider,
} from './declarations'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useLocale } from '@/context/i18n'
import { fetchDefaultModal, fetchModelList, fetchModelProviderCredentials } from '@/service/common'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelModalModeEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from './declarations'
import {
  useAnthropicBuyQuota,
  useCurrentProviderAndModel,
  useDefaultModel,
  useLanguage,
  useMarketplaceAllPlugins,
  useModelList,
  useModelListAndDefaultModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useModelModalHandler,
  useProviderCredentialsAndLoadBalancing,
  useRefreshModel,
  useSystemDefaultModelAndModelList,
  useTextGenerationCurrentProviderAndModelAndModelList,
  useUpdateModelList,
  useUpdateModelProviders,
} from './hooks'
import { UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST } from './provider-added-card'

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
  fetchModelProviderCredentials: vi.fn(),
  getPayUrl: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  commonQueryKeys: {
    modelList: (type: string) => ['model-list', type],
    modelProviders: ['model-providers'],
    defaultModel: (type: string) => ['default-model', type],
  },
}))

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(() => ({
    textGenerationModelList: [],
  })),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: vi.fn((selector) => {
    const state = { setShowModelModal: vi.fn() }
    return selector(state)
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: vi.fn(() => ({
    eventEmitter: {
      emit: vi.fn(),
    },
  })),
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

const { useQuery, useQueryClient } = await import('@tanstack/react-query')
const { getPayUrl } = await import('@/service/common')
const { useProviderContext } = await import('@/context/provider-context')
const { useModalContextSelector } = await import('@/context/modal-context')
const { useEventEmitterContextContext } = await import('@/context/event-emitter')
const { useMarketplacePlugins, useMarketplacePluginsByCollectionId } = await import('@/app/components/plugins/marketplace/hooks')

describe('hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useLanguage', () => {
    it('should replace hyphen with underscore in locale', () => {
      ; (useLocale as Mock).mockReturnValue('en-US')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('en_US')
    })

    it('should return locale as is if no hyphen exists', () => {
      ; (useLocale as Mock).mockReturnValue('enUS')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('enUS')
    })

    it('should handle Chinese locale', () => {
      ; (useLocale as Mock).mockReturnValue('zh-Hans')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('zh_Hans')
    })

    it('should only replace the first hyphen when multiple exist', () => {
      ; (useLocale as Mock).mockReturnValue('en-GB-custom')
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('en_GB-custom')
    })
  })

  describe('useSystemDefaultModelAndModelList', () => {
    const createMockModelList = (): Model[] => [{
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
    }]

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
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(defaultModel, modelList))

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
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(defaultModel, modelList))

      expect(result.current[0]).toBeUndefined()
    })

    it('should return undefined when model not found in provider', () => {
      const defaultModel = createMockDefaultModel('gpt-5')
      const modelList = createMockModelList()
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(defaultModel, modelList))

      expect(result.current[0]).toBeUndefined()
    })

    it('should update default model state', () => {
      const defaultModel = createMockDefaultModel()
      const modelList = createMockModelList()
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(defaultModel, modelList))

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

  describe('useProviderCredentialsAndLoadBalancing', () => {
    const mockCredentials = { api_key: 'test-key', enabled: true }
    const mockLoadBalancing = { enabled: true, configs: [] }

    beforeEach(() => {
      ; (useQueryClient as Mock).mockReturnValue({
        invalidateQueries: vi.fn(),
      })
    })

    it('should fetch predefined credentials when configured', async () => {
      (useQuery as Mock).mockReturnValue({
        data: { credentials: mockCredentials, load_balancing: mockLoadBalancing },
        isPending: false,
      })

      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.predefinedModel,
        true,
        undefined,
        'cred-id',
      ))

      expect(result.current.credentials).toEqual(mockCredentials)
      expect(result.current.loadBalancing).toEqual(mockLoadBalancing)
      expect(result.current.isLoading).toBe(false)

      // Coverage for queryFn
      const queryCall = (useQuery as Mock).mock.calls.find(call => call[0].queryKey[1] === 'credentials')
      if (queryCall) {
        await queryCall[0].queryFn()
        expect(fetchModelProviderCredentials).toHaveBeenCalled()
      }
    })

    it('should not fetch predefined credentials when not configured', () => {
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: false,
      })

      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.predefinedModel,
        false,
        undefined,
        'cred-id',
      ))

      expect(result.current.credentials).toBeUndefined()
    })

    it('should fetch custom credentials with model fields', async () => {
      (useQuery as Mock).mockReturnValue({
        data: { credentials: mockCredentials, load_balancing: mockLoadBalancing },
        isPending: false,
      })

      const customFields = { __model_name: 'gpt-4', __model_type: ModelTypeEnum.textGeneration }
      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.customizableModel,
        true,
        customFields,
        'cred-id',
      ))

      expect(result.current.credentials).toEqual({
        ...mockCredentials,
        ...customFields,
      })

      // Coverage for queryFn
      const queryCall = (useQuery as Mock).mock.calls.find(call => call[0].queryKey[1] === 'models')
      if (queryCall) {
        await queryCall[0].queryFn()
        expect(fetchModelProviderCredentials).toHaveBeenCalled()
      }
    })

    it('should return undefined credentials when custom data is not available', () => {
      (useQuery as Mock).mockReturnValue({
        data: { load_balancing: mockLoadBalancing },
        isPending: false,
      })

      const customFields = { __model_name: 'gpt-4', __model_type: ModelTypeEnum.textGeneration }
      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.customizableModel,
        true,
        customFields,
        'cred-id',
      ))

      expect(result.current.credentials).toBeUndefined()
    })

    it('should handle loading state', () => {
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: true,
      })

      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.predefinedModel,
        true,
        undefined,
        'cred-id',
      ))

      expect(result.current.isLoading).toBe(true)
    })

    it('should call mutate and invalidate queries for predefined model', () => {
      const invalidateQueries = vi.fn()
        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ; (useQuery as Mock).mockReturnValue({
        data: { credentials: mockCredentials },
        isPending: false,
      })

      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.predefinedModel,
        true,
        undefined,
        'cred-id',
      ))

      act(() => {
        result.current.mutate()
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-providers', 'credentials', 'openai', 'cred-id'],
      })
    })

    it('should call mutate and invalidate queries for custom model', () => {
      const invalidateQueries = vi.fn()
        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ; (useQuery as Mock).mockReturnValue({
        data: { credentials: mockCredentials },
        isPending: false,
      })

      const customFields = { __model_name: 'gpt-4', __model_type: ModelTypeEnum.textGeneration }
      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.customizableModel,
        true,
        customFields,
        'cred-id',
      ))

      act(() => {
        result.current.mutate()
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-providers', 'models', 'credentials', 'openai', ModelTypeEnum.textGeneration, 'gpt-4', 'cred-id'],
      })
    })

    it('should return undefined credentials when credentialId is not provided', () => {
      // When credentialId is absent, predefinedEnabled=false so query is disabled and returns no data
      ; (useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: false,
      })

      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.predefinedModel,
        true,
        undefined,
        undefined,
      ))

      expect(result.current.credentials).toBeUndefined()
    })
  })

  describe('useModelList', () => {
    const mockModelData = [
      { provider: 'openai', models: [{ model: 'gpt-4' }] },
      { provider: 'anthropic', models: [{ model: 'claude-3' }] },
    ]

    it('should fetch model list successfully', async () => {
      const refetch = vi.fn()
        ; (useQuery as Mock).mockReturnValue({
        data: { data: mockModelData },
        isPending: false,
        refetch,
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      expect(result.current.data).toEqual(mockModelData)
      expect(result.current.isLoading).toBe(false)

      // Coverage for queryFn
      const queryCall = (useQuery as Mock).mock.calls.find(call => Array.isArray(call[0].queryKey) && call[0].queryKey[0] === 'model-list')
      if (queryCall) {
        await queryCall[0].queryFn()
        expect(fetchModelList).toHaveBeenCalled()
      }
    })

    it('should return empty array when data is undefined', () => {
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: false,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      expect(result.current.data).toEqual([])
    })

    it('should handle loading state', () => {
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: true,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      expect(result.current.isLoading).toBe(true)
    })

    it('should call mutate to refetch data', () => {
      const refetch = vi.fn()
        ; (useQuery as Mock).mockReturnValue({
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
      (useQuery as Mock).mockReturnValue({
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
        ; (useQuery as Mock).mockReturnValue({
        data: { data: mockDefaultModel },
        isPending: false,
        refetch,
      })

      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.data).toEqual(mockDefaultModel)
      expect(result.current.isLoading).toBe(false)

      // Coverage for queryFn
      const queryCall = (useQuery as Mock).mock.calls.find(call => Array.isArray(call[0].queryKey) && call[0].queryKey[0] === 'default-model')
      if (queryCall) {
        await queryCall[0].queryFn()
        expect(fetchDefaultModal).toHaveBeenCalled()
      }
    })

    it('should return undefined when data is not available', () => {
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: false,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.data).toBeUndefined()
    })

    it('should handle loading state', () => {
      (useQuery as Mock).mockReturnValue({
        data: undefined,
        isPending: true,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.isLoading).toBe(true)
    })

    it('should call mutate to refetch data', () => {
      const refetch = vi.fn()
        ; (useQuery as Mock).mockReturnValue({
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

  describe('useCurrentProviderAndModel', () => {
    const createModelList = (): Model[] => [{
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
    }]

    it('should find current provider and model', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'openai', model: 'gpt-4' }

      const { result } = renderHook(() => useCurrentProviderAndModel(modelList, defaultModel))

      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should return undefined when provider not found', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'anthropic', model: 'claude-3' }

      const { result } = renderHook(() => useCurrentProviderAndModel(modelList, defaultModel))

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })

    it('should return undefined when model not found', () => {
      const modelList = createModelList()
      const defaultModel = { provider: 'openai', model: 'gpt-5' }

      const { result } = renderHook(() => useCurrentProviderAndModel(modelList, defaultModel))

      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel).toBeUndefined()
    })

    it('should handle undefined default model', () => {
      const modelList = createModelList()

      const { result } = renderHook(() => useCurrentProviderAndModel(modelList, undefined))

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })

    it('should handle empty model list', () => {
      const defaultModel = { provider: 'openai', model: 'gpt-4' }

      const { result } = renderHook(() => useCurrentProviderAndModel([], defaultModel))

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
        models: [{
          model: 'gpt-4',
          label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
          model_type: ModelTypeEnum.textGeneration,
          fetch_from: ConfigurationMethodEnum.predefinedModel,
          status: ModelStatusEnum.active,
          model_properties: {},
          load_balancing_enabled: false,
        }],
        status: ModelStatusEnum.active,
      },
      {
        provider: 'anthropic',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' },
        models: [{
          model: 'claude-3',
          label: { en_US: 'Claude 3', zh_Hans: 'Claude 3' },
          model_type: ModelTypeEnum.textGeneration,
          fetch_from: ConfigurationMethodEnum.predefinedModel,
          status: ModelStatusEnum.disabled,
          model_properties: {},
          load_balancing_enabled: false,
        }],
        status: ModelStatusEnum.disabled,
      },
    ]

    it('should return all text generation model lists', () => {
      const modelList = createModelList()
        ; (useProviderContext as Mock).mockReturnValue({
        textGenerationModelList: modelList,
      })

      const defaultModel = { provider: 'openai', model: 'gpt-4' }
      const { result } = renderHook(() => useTextGenerationCurrentProviderAndModelAndModelList(defaultModel))

      expect(result.current.textGenerationModelList).toEqual(modelList)
      expect(result.current.activeTextGenerationModelList).toHaveLength(1)
      expect(result.current.activeTextGenerationModelList[0].provider).toBe('openai')
    })

    it('should filter active models correctly', () => {
      const modelList = createModelList()
        ; (useProviderContext as Mock).mockReturnValue({
        textGenerationModelList: modelList,
      })

      const { result } = renderHook(() => useTextGenerationCurrentProviderAndModelAndModelList())

      expect(result.current.activeTextGenerationModelList).toHaveLength(1)
      expect(result.current.activeTextGenerationModelList[0].status).toBe(ModelStatusEnum.active)
    })

    it('should find current provider and model', () => {
      const modelList = createModelList()
        ; (useProviderContext as Mock).mockReturnValue({
        textGenerationModelList: modelList,
      })

      const defaultModel = { provider: 'openai', model: 'gpt-4' }
      const { result } = renderHook(() => useTextGenerationCurrentProviderAndModelAndModelList(defaultModel))

      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should handle empty model list', () => {
      ; (useProviderContext as Mock).mockReturnValue({
        textGenerationModelList: [],
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

        ; (useQuery as Mock)
        .mockReturnValueOnce({ data: { data: mockModelData }, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({ data: { data: mockDefaultModel }, isPending: false, refetch: vi.fn() })

      const { result } = renderHook(() => useModelListAndDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.modelList).toEqual(mockModelData)
      expect(result.current.defaultModel).toEqual(mockDefaultModel)
    })

    it('should handle undefined values', () => {
      ; (useQuery as Mock)
        .mockReturnValueOnce({ data: undefined, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({ data: undefined, isPending: false, refetch: vi.fn() })

      const { result } = renderHook(() => useModelListAndDefaultModel(ModelTypeEnum.textGeneration))

      expect(result.current.modelList).toEqual([])
      expect(result.current.defaultModel).toBeUndefined()
    })
  })

  describe('useModelListAndDefaultModelAndCurrentProviderAndModel', () => {
    it('should return complete data structure', () => {
      const mockModelData = [{
        provider: 'openai',
        icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
        models: [{
          model: 'gpt-4',
          label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
          model_type: ModelTypeEnum.textGeneration,
          fetch_from: ConfigurationMethodEnum.predefinedModel,
          status: ModelStatusEnum.active,
          model_properties: {},
          load_balancing_enabled: false,
        }],
        status: ModelStatusEnum.active,
      }]
      const mockDefaultModel = {
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
        provider: { provider: 'openai', icon_small: { en_US: 'icon', zh_Hans: 'icon' } },
      }

        ; (useQuery as Mock)
        .mockReturnValueOnce({ data: { data: mockModelData }, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({ data: { data: mockDefaultModel }, isPending: false, refetch: vi.fn() })

      const { result } = renderHook(() => useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration))

      expect(result.current.modelList).toEqual(mockModelData)
      expect(result.current.defaultModel).toEqual(mockDefaultModel)
      expect(result.current.currentProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('gpt-4')
    })

    it('should handle missing default model', () => {
      const mockModelData = [{
        provider: 'openai',
        models: [],
        status: ModelStatusEnum.active,
      }]

        ; (useQuery as Mock)
        .mockReturnValueOnce({ data: { data: mockModelData }, isPending: false, refetch: vi.fn() })
        .mockReturnValueOnce({ data: undefined, isPending: false, refetch: vi.fn() })

      const { result } = renderHook(() => useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration))

      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
    })
  })

  describe('useUpdateModelList', () => {
    it('should invalidate model list queries', () => {
      const invalidateQueries = vi.fn()
        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelList())

      act(() => {
        result.current(ModelTypeEnum.textGeneration)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-list', ModelTypeEnum.textGeneration],
      })
    })

    it('should handle multiple model types', () => {
      const invalidateQueries = vi.fn()
        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelList())

      act(() => {
        result.current(ModelTypeEnum.textGeneration)
        result.current(ModelTypeEnum.textEmbedding)
        result.current(ModelTypeEnum.rerank)
      })

      expect(invalidateQueries).toHaveBeenCalledTimes(3)
    })
  })

  describe('useAnthropicBuyQuota', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
        configurable: true,
      })
    })

    it('should fetch payment URL and redirect', async () => {
      const mockUrl = 'https://payment.anthropic.com/checkout'
        ; (getPayUrl as Mock).mockResolvedValue({ url: mockUrl })

      const { result } = renderHook(() => useAnthropicBuyQuota())

      await act(async () => {
        await result.current()
      })

      expect(getPayUrl).toHaveBeenCalledWith('/workspaces/current/model-providers/anthropic/checkout-url')
      await waitFor(() => {
        expect(window.location.href).toBe(mockUrl)
      })
    })

    it('should prevent concurrent calls while loading', async () => {
      // The loading guard in useAnthropicBuyQuota relies on React re-render to expose `loading=true`.
      // A slow first call keeps loading=true after the first render; a second call from the
      // re-rendered hook captures loading=true and returns early.
      let resolveFirst: (value: { url: string }) => void
      const firstCallPromise = new Promise<{ url: string }>((resolve) => {
        resolveFirst = resolve
      })
        ; (getPayUrl as Mock)
        .mockReturnValueOnce(firstCallPromise)
        .mockResolvedValue({ url: 'https://example.com' })

      const { result } = renderHook(() => useAnthropicBuyQuota())

      // Start the first call – this sets loading=true
      let firstCall: Promise<void>
      act(() => {
        firstCall = result.current()
      })

      // Wait for re-render where loading=true
      // Then call again while loading is true to hit the guard (line 230)
      act(() => {
        result.current()
      })

      // Resolve the first promise
      await act(async () => {
        resolveFirst!({ url: 'https://example.com' })
        await firstCall!
      })

      // Should only be called once due to loading guard
      expect(getPayUrl).toHaveBeenCalledTimes(1)
    })

    it('should handle errors gracefully and reset loading state', async () => {
      ; (getPayUrl as Mock).mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useAnthropicBuyQuota())

      // The hook does not catch the error, so it re-throws; wrap it to avoid unhandled rejection
      await act(async () => {
        try {
          await result.current()
        }
        catch {
          // expected rejection
        }
      })

      expect(getPayUrl).toHaveBeenCalledWith('/workspaces/current/model-providers/anthropic/checkout-url')

      // After error, loading state is reset via finally block — a second call should proceed
      ; (getPayUrl as Mock).mockResolvedValue({ url: 'https://example.com' })
      await act(async () => {
        await result.current()
      })
      expect(getPayUrl).toHaveBeenCalledTimes(2)
    })
  })

  describe('useUpdateModelProviders', () => {
    it('should invalidate model providers queries', () => {
      const invalidateQueries = vi.fn()
        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelProviders())

      act(() => {
        result.current()
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-providers'],
      })
    })

    it('should be callable multiple times', () => {
      const invalidateQueries = vi.fn()
        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })

      const { result } = renderHook(() => useUpdateModelProviders())

      act(() => {
        result.current()
        result.current()
        result.current()
      })

      expect(invalidateQueries).toHaveBeenCalledTimes(3)
    })
  })

  describe('useMarketplaceAllPlugins', () => {
    const createMockProviders = (): ModelProvider[] => [{
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
    }]

    const createMockPlugins = () => [
      { plugin_id: 'plugin1', type: 'plugin' },
      { plugin_id: 'plugin2', type: 'plugin' },
    ]

    it('should combine collection and regular plugins', () => {
      const providers = createMockProviders()
      const collectionPlugins = [{ plugin_id: 'collection1', type: 'plugin' }]
      const regularPlugins = createMockPlugins()

        ; (useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: collectionPlugins,
        isLoading: false,
      })
      ; (useMarketplacePlugins as Mock).mockReturnValue({
        plugins: regularPlugins,
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins(providers, ''))

      expect(result.current.plugins).toHaveLength(3)
      expect(result.current.isLoading).toBe(false)
    })

    it('should exclude installed providers', () => {
      const providers = createMockProviders()
      const collectionPlugins = [
        { plugin_id: 'openai', type: 'plugin' },
        { plugin_id: 'other', type: 'plugin' },
      ]

        ; (useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: collectionPlugins,
        isLoading: false,
      })
      ; (useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins(providers, ''))

      expect(result.current.plugins!).toHaveLength(1)
      expect(result.current.plugins![0].plugin_id).toBe('other')
    })

    it('should use search when searchText is provided', () => {
      const queryPluginsWithDebounced = vi.fn()
        ; (useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced,
        isLoading: false,
      })
      ; (useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: false,
      })

      renderHook(() => useMarketplaceAllPlugins([], 'test search'))

      expect(queryPluginsWithDebounced).toHaveBeenCalled()
    })

    it('should filter out bundle types', () => {
      const plugins = [
        { plugin_id: 'plugin1', type: 'plugin' },
        { plugin_id: 'bundle1', type: 'bundle' },
      ]

        ; (useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: false,
      })
      ; (useMarketplacePlugins as Mock).mockReturnValue({
        plugins,
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: false,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins([], ''))

      expect(result.current.plugins!).toHaveLength(1)
      expect(result.current.plugins![0].plugin_id).toBe('plugin1')
    })

    it('should handle loading states', () => {
      ; (useMarketplacePluginsByCollectionId as Mock).mockReturnValue({
        plugins: [],
        isLoading: true,
      })
      ; (useMarketplacePlugins as Mock).mockReturnValue({
        plugins: [],
        queryPlugins: vi.fn(),
        queryPluginsWithDebounced: vi.fn(),
        isLoading: true,
      })

      const { result } = renderHook(() => useMarketplaceAllPlugins([], ''))

      expect(result.current.isLoading).toBe(true)
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
      const emit = vi.fn()

        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ; (useEventEmitterContextContext as Mock).mockReturnValue({
        eventEmitter: { emit },
      })

      const provider = createMockProvider()
      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['model-providers'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['model-list', ModelTypeEnum.textGeneration] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['model-list', ModelTypeEnum.textEmbedding] })
    })

    it('should emit event when refreshModelList is true and custom config is active', () => {
      const invalidateQueries = vi.fn()
      const emit = vi.fn()

        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ; (useEventEmitterContextContext as Mock).mockReturnValue({
        eventEmitter: { emit },
      })

      const provider = createMockProvider()
      const customFields: CustomConfigurationModelFixedFields = {
        __model_name: 'gpt-4',
        __model_type: ModelTypeEnum.textGeneration,
      }

      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider, customFields, true)
      })

      expect(emit).toHaveBeenCalledWith({
        type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
        payload: 'openai',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['model-list', ModelTypeEnum.textGeneration] })
    })

    it('should not emit event when custom config is not active', () => {
      const invalidateQueries = vi.fn()
      const emit = vi.fn()

        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ; (useEventEmitterContextContext as Mock).mockReturnValue({
        eventEmitter: { emit },
      })

      const provider = { ...createMockProvider(), custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure } }

      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider, undefined, true)
      })

      expect(emit).not.toHaveBeenCalled()
    })

    it('should handle provider with single model type', () => {
      const invalidateQueries = vi.fn()

        ; (useQueryClient as Mock).mockReturnValue({ invalidateQueries })
      ; (useEventEmitterContextContext as Mock).mockReturnValue({
        eventEmitter: { emit: vi.fn() },
      })

      const provider = {
        ...createMockProvider(),
        supported_model_types: [ModelTypeEnum.textGeneration],
      }

      const { result } = renderHook(() => useRefreshModel())

      act(() => {
        result.current.handleRefreshModel(provider)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['model-providers'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['model-list', ModelTypeEnum.textGeneration] })
      expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['model-list', ModelTypeEnum.textEmbedding] })
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
        ; (useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

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
        ; (useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

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
        ; (useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()
      const credential: Credential = { credential_id: 'cred-1' }
      const model: CustomModel = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration }
      const onUpdate = vi.fn()

      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(
          provider,
          ConfigurationMethodEnum.predefinedModel,
          undefined,
          {
            isModelCredential: true,
            credential,
            model,
            onUpdate,
            mode: ModelModalModeEnum.configProviderCredential,
          },
        )
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
        ; (useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()
      const onUpdate = vi.fn()

      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(
          provider,
          ConfigurationMethodEnum.predefinedModel,
          undefined,
          { onUpdate },
        )
      })

      const callArgs = setShowModelModal.mock.calls[0][0]
      const newPayload = { test: 'data' }
      const formValues = { field: 'value' }

      act(() => {
        callArgs.onSaveCallback(newPayload, formValues)
      })

      expect(onUpdate).toHaveBeenCalledWith(newPayload, formValues)
    })

    it('should handle modal without onUpdate callback', () => {
      const setShowModelModal = vi.fn()
        ; (useModalContextSelector as Mock).mockReturnValue(setShowModelModal)

      const provider = createMockProvider()

      const { result } = renderHook(() => useModelModalHandler())

      act(() => {
        result.current(provider, ConfigurationMethodEnum.predefinedModel)
      })

      const callArgs = setShowModelModal.mock.calls[0][0]

      // Should not throw when onUpdate is not provided
      expect(() => {
        callArgs.onSaveCallback({ test: 'data' }, { field: 'value' })
      }).not.toThrow()
    })
  })
})
