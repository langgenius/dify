import type { ReactNode } from 'react'
import type { ModelProvider } from '../../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import * as React from 'react'
import { ConfigurationMethodEnum, ModelTypeEnum, PreferredProviderTypeEnum } from '../../declarations'
import { useChangeProviderPriority } from '../use-change-provider-priority'

const mockUpdateModelList = vi.fn()
const mockUpdateModelProviders = vi.fn()
const mockNotify = vi.fn()
const mockQueryKey = vi.fn(({ input }: { input: { params: { provider: string } } }) => ['model-providers', 'models', input.params.provider])
const mockChangePreferredProviderType = vi.fn()
const mockMutationOptions = vi.fn((options: Record<string, unknown>) => ({
  mutationFn: (variables: unknown) => mockChangePreferredProviderType(variables),
  ...options,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  default: {
    notify: (...args: unknown[]) => mockNotify(...args),
  },
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    modelProviders: {
      models: {
        queryKey: (options: { input: { params: { provider: string } } }) => mockQueryKey(options),
      },
      changePreferredProviderType: {
        mutationOptions: (options: Record<string, unknown>) => mockMutationOptions(options),
      },
    },
  },
}))

vi.mock('../../hooks', () => ({
  useUpdateModelList: () => mockUpdateModelList,
  useUpdateModelProviders: () => mockUpdateModelProviders,
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'langgenius/openai/openai',
  configurate_methods: [
    ConfigurationMethodEnum.customizableModel,
    ConfigurationMethodEnum.predefinedModel,
  ],
  supported_model_types: [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding],
  label: { en_US: 'OpenAI' },
  icon_small: { en_US: 'https://example.com/icon.png' },
  provider_credential_schema: { credential_form_schemas: [] },
  model_credential_schema: {
    model: {
      label: { en_US: 'Model' },
      placeholder: { en_US: 'Select model' },
    },
    credential_form_schemas: [],
  },
  ...overrides,
} as ModelProvider)

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
})

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  )
}

describe('useChangeProviderPriority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChangePreferredProviderType.mockResolvedValue(undefined)
  })

  describe('when changing provider priority', () => {
    it('should submit the selected preferred provider type for the current provider', async () => {
      const queryClient = createTestQueryClient()
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
      const provider = createProvider()
      const { result } = renderHook(() => useChangeProviderPriority(provider), {
        wrapper: createWrapper(queryClient),
      })

      act(() => {
        result.current.handleChangePriority(PreferredProviderTypeEnum.custom)
      })

      await waitFor(() => {
        expect(mockChangePreferredProviderType).toHaveBeenCalledWith({
          params: { provider: 'langgenius/openai/openai' },
          body: { preferred_provider_type: PreferredProviderTypeEnum.custom },
        })
      })

      expect(mockQueryKey).toHaveBeenCalledWith({
        input: {
          params: {
            provider: 'langgenius/openai/openai',
          },
        },
      })
      expect(mockMutationOptions).toHaveBeenCalled()
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-providers', 'models', 'langgenius/openai/openai'],
        exact: true,
        refetchType: 'none',
      })
      expect(mockUpdateModelProviders).toHaveBeenCalledTimes(1)
      expect(mockUpdateModelList).toHaveBeenCalledTimes(2)
      expect(mockUpdateModelList).toHaveBeenNthCalledWith(1, ModelTypeEnum.textGeneration)
      expect(mockUpdateModelList).toHaveBeenNthCalledWith(2, ModelTypeEnum.textEmbedding)
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
      expect(result.current.isChangingPriority).toBe(false)
    })

    it('should tolerate an undefined provider and still submit a request without refreshing model lists', async () => {
      const queryClient = createTestQueryClient()
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
      const { result } = renderHook(() => useChangeProviderPriority(undefined), {
        wrapper: createWrapper(queryClient),
      })

      act(() => {
        result.current.handleChangePriority(PreferredProviderTypeEnum.system)
      })

      await waitFor(() => {
        expect(mockChangePreferredProviderType).toHaveBeenCalledWith({
          params: { provider: '' },
          body: { preferred_provider_type: PreferredProviderTypeEnum.system },
        })
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['model-providers', 'models', ''],
        exact: true,
        refetchType: 'none',
      })
      expect(mockUpdateModelProviders).toHaveBeenCalledTimes(1)
      expect(mockUpdateModelList).not.toHaveBeenCalled()
    })
  })

  describe('when the mutation is not successful immediately', () => {
    it('should show an error toast when the mutation fails', async () => {
      const queryClient = createTestQueryClient()
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
      mockChangePreferredProviderType.mockRejectedValueOnce(new Error('network error'))
      const { result } = renderHook(() => useChangeProviderPriority(createProvider()), {
        wrapper: createWrapper(queryClient),
      })

      act(() => {
        result.current.handleChangePriority(PreferredProviderTypeEnum.custom)
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        })
      })

      expect(invalidateQueries).not.toHaveBeenCalled()
      expect(mockUpdateModelProviders).not.toHaveBeenCalled()
      expect(mockUpdateModelList).not.toHaveBeenCalled()
      expect(result.current.isChangingPriority).toBe(false)
    })

    it('should expose the pending mutation state while the request is in flight', async () => {
      let resolveMutation: (() => void) | undefined
      mockChangePreferredProviderType.mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveMutation = resolve
      }))

      const queryClient = createTestQueryClient()
      const { result } = renderHook(() => useChangeProviderPriority(createProvider()), {
        wrapper: createWrapper(queryClient),
      })

      act(() => {
        result.current.handleChangePriority(PreferredProviderTypeEnum.custom)
      })

      await waitFor(() => {
        expect(result.current.isChangingPriority).toBe(true)
      })

      await act(async () => {
        resolveMutation?.()
      })

      await waitFor(() => {
        expect(result.current.isChangingPriority).toBe(false)
      })
    })
  })
})
