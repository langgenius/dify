import type { CustomModel } from '../../../declarations'
import { QueryClient, QueryClientProvider, skipToken } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { ModelTypeEnum } from '../../../declarations'
import { useAuthService, useGetCredential } from '../use-auth-service'

const mocks = vi.hoisted(() => ({
  providerCredentialOptions: vi.fn(),
  modelCredentialOptions: vi.fn(),
  addProviderCredential: vi.fn(),
  editProviderCredential: vi.fn(),
  deleteProviderCredential: vi.fn(),
  switchProviderCredential: vi.fn(),
  addModelCredential: vi.fn(),
  editModelCredential: vi.fn(),
  deleteModelCredential: vi.fn(),
  switchModelCredential: vi.fn(),
}))

const { createQueryOptions } = vi.hoisted(() => ({
  createQueryOptions:
    (name: string, fetcher: (input: unknown) => void) =>
    ({ input }: { input: unknown }) => {
      fetcher(input)
      return {
        queryKey: [name, input],
        queryFn: typeof input === 'symbol' ? input : () => ({ source: name }),
      }
    },
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        modelProviders: {
          byProvider: {
            credentials: {
              get: {
                queryOptions: createQueryOptions('provider', mocks.providerCredentialOptions),
              },
            },
            models: {
              credentials: {
                get: { queryOptions: createQueryOptions('model', mocks.modelCredentialOptions) },
              },
            },
          },
        },
      },
    },
  },
  consoleClient: {
    workspaces: {
      current: {
        modelProviders: {
          byProvider: {
            credentials: {
              post: mocks.addProviderCredential,
              put: mocks.editProviderCredential,
              delete: mocks.deleteProviderCredential,
              switch: { post: mocks.switchProviderCredential },
            },
            models: {
              credentials: {
                post: mocks.addModelCredential,
                put: mocks.editModelCredential,
                delete: mocks.deleteModelCredential,
                switch: { post: mocks.switchModelCredential },
              },
            },
          },
        },
      },
    },
  },
}))

// The services are selected at runtime, so call sites pass a payload of either shape.
type CredentialService = (payload: unknown) => Promise<unknown>

describe('useAuthService hooks', () => {
  let queryClient: QueryClient
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const model: CustomModel = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('should query the provider credential only when a credential id is given', () => {
    renderHook(() => useGetCredential('openai', false, 'cred-123'), { wrapper })
    expect(mocks.providerCredentialOptions).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      query: { credential_id: 'cred-123' },
    })

    renderHook(() => useGetCredential('openai', false), { wrapper })
    expect(mocks.providerCredentialOptions).toHaveBeenLastCalledWith(skipToken)
  })

  it('should query the model credential only when a model is given', () => {
    renderHook(() => useGetCredential('openai', true, 'cred-123', model, 'custom-model'), {
      wrapper,
    })
    expect(mocks.modelCredentialOptions).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      query: {
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
        config_from: 'custom-model',
        credential_id: 'cred-123',
      },
    })

    renderHook(() => useGetCredential('openai', true, 'cred-123'), { wrapper })
    expect(mocks.modelCredentialOptions).toHaveBeenLastCalledWith(skipToken)
  })

  it('should send provider credential changes to the provider endpoints', async () => {
    const { result } = renderHook(() => useAuthService('openai'), { wrapper })
    const credential = { credential_id: 'cred-1', name: 'Main', credentials: { key: 'v' } }

    await act(async () => {
      await (result.current.getAddCredentialService(false) as CredentialService)(credential)
      await (result.current.getEditCredentialService(false) as CredentialService)(credential)
      await (result.current.getDeleteCredentialService(false) as CredentialService)({
        credential_id: 'cred-1',
      })
      await (result.current.getActiveCredentialService(false) as CredentialService)({
        credential_id: 'cred-1',
      })
    })

    const params = { provider: 'openai' }
    expect(mocks.addProviderCredential).toHaveBeenCalledWith({ params, body: credential })
    expect(mocks.editProviderCredential).toHaveBeenCalledWith({ params, body: credential })
    expect(mocks.deleteProviderCredential).toHaveBeenCalledWith({
      params,
      body: { credential_id: 'cred-1' },
    })
    expect(mocks.switchProviderCredential).toHaveBeenCalledWith({
      params,
      body: { credential_id: 'cred-1' },
    })
  })

  it('should send model credential changes to the model endpoints', async () => {
    const { result } = renderHook(() => useAuthService('openai'), { wrapper })
    const credential = { ...model, credential_id: 'cred-1', credentials: { key: 'v' } }
    const ref = { ...model, credential_id: 'cred-1' }

    await act(async () => {
      await (result.current.getAddCredentialService(true) as CredentialService)(credential)
      await (result.current.getEditCredentialService(true) as CredentialService)(credential)
      await (result.current.getDeleteCredentialService(true) as CredentialService)(ref)
      await (result.current.getActiveCredentialService(true) as CredentialService)(ref)
    })

    const params = { provider: 'openai' }
    expect(mocks.addModelCredential).toHaveBeenCalledWith({ params, body: credential })
    expect(mocks.editModelCredential).toHaveBeenCalledWith({ params, body: credential })
    // The model credential delete endpoint takes its fields as query parameters.
    expect(mocks.deleteModelCredential).toHaveBeenCalledWith({ params, query: ref })
    expect(mocks.switchModelCredential).toHaveBeenCalledWith({ params, body: ref })
  })
})
