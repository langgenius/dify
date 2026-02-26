import type { Mock } from 'vitest'
import type {
  DefaultModelResponse,
  Model,
} from './declarations'
import { act, renderHook } from '@testing-library/react'
import { useLocale } from '@/context/i18n'
import {
  ConfigurationMethodEnum,
  ModelTypeEnum,
} from './declarations'
import {
  useLanguage,
  useModelList,
  useProviderCredentialsAndLoadBalancing,
  useSystemDefaultModelAndModelList,
} from './hooks'

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

const { useQuery } = await import('@tanstack/react-query')
const { fetchModelList, fetchModelProviderCredentials } = await import('@/service/common')

describe('hooks', () => {
  afterEach(() => {
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
  })

  describe('useSystemDefaultModelAndModelList', () => {
    it('should return default model state', () => {
      const defaultModel = {
        provider: {
          provider: 'openai',
          icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        },
        model: 'gpt-3.5',
        model_type: ModelTypeEnum.textGeneration,
      } as unknown as DefaultModelResponse
      const modelList = [{ provider: 'openai', models: [{ model: 'gpt-3.5' }] }] as unknown as Model[]
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(defaultModel, modelList))

      expect(result.current[0]).toEqual({ model: 'gpt-3.5', provider: 'openai' })
    })

    it('should update default model state', () => {
      const defaultModel = {
        provider: {
          provider: 'openai',
          icon_small: { en_US: 'icon', zh_Hans: 'icon' },
        },
        model: 'gpt-3.5',
        model_type: ModelTypeEnum.textGeneration,
      } as any
      const modelList = [{ provider: 'openai', models: [{ model: 'gpt-3.5' }] }] as any
      const { result } = renderHook(() => useSystemDefaultModelAndModelList(defaultModel, modelList))

      const newModel = { model: 'gpt-4', provider: 'openai' }
      act(() => {
        result.current[1](newModel)
      })

      expect(result.current[0]).toEqual(newModel)
    })
  })

  describe('useProviderCredentialsAndLoadBalancing', () => {
    it('should fetch predefined credentials', async () => {
      (useQuery as Mock).mockReturnValue({
        data: { credentials: { key: 'value' }, load_balancing: { enabled: true } },
        isPending: false,
      })

      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.predefinedModel,
        true,
        undefined,
        'cred-id',
      ))

      expect(result.current.credentials).toEqual({ key: 'value' })
      expect(result.current.loadBalancing).toEqual({ enabled: true })
      expect(fetchModelProviderCredentials).not.toHaveBeenCalled() // useQuery calls it, but we blocked it with mockReturnValue
    })

    it('should fetch custom credentials', () => {
      (useQuery as Mock).mockReturnValue({
        data: { credentials: { key: 'value' }, load_balancing: { enabled: true } },
        isPending: false,
      })

      const { result } = renderHook(() => useProviderCredentialsAndLoadBalancing(
        'openai',
        ConfigurationMethodEnum.customizableModel,
        true,
        { __model_name: 'gpt-4', __model_type: ModelTypeEnum.textGeneration },
        'cred-id',
      ))

      expect(result.current.credentials).toEqual({
        key: 'value',
        __model_name: 'gpt-4',
        __model_type: ModelTypeEnum.textGeneration,
      })
    })
  })

  describe('useModelList', () => {
    it('should fetch model list', () => {
      (useQuery as Mock).mockReturnValue({
        data: { data: [{ model: 'gpt-4' }] },
        isPending: false,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useModelList(ModelTypeEnum.textGeneration))

      expect(result.current.data).toEqual([{ model: 'gpt-4' }])
      expect(fetchModelList).not.toHaveBeenCalled()
    })
  })
})
