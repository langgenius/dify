import type { CustomModel } from '../../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { ModelTypeEnum } from '../../declarations'
import { useAuthService, useGetCredential } from './use-auth-service'

vi.mock('@/service/use-models', () => ({
  useGetProviderCredential: vi.fn(),
  useGetModelCredential: vi.fn(),
  useAddProviderCredential: vi.fn(),
  useEditProviderCredential: vi.fn(),
  useDeleteProviderCredential: vi.fn(),
  useActiveProviderCredential: vi.fn(),
  useAddModelCredential: vi.fn(),
  useEditModelCredential: vi.fn(),
  useDeleteModelCredential: vi.fn(),
  useActiveModelCredential: vi.fn(),
}))

const {
  useGetProviderCredential,
  useGetModelCredential,
  useAddProviderCredential,
  useEditProviderCredential,
  useDeleteProviderCredential,
  useActiveProviderCredential,
  useAddModelCredential,
  useEditModelCredential,
  useDeleteModelCredential,
  useActiveModelCredential,
} = await import('@/service/use-models')

describe('useAuthService hooks', () => {
  let queryClient: QueryClient
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const mockMutationReturn = { mutateAsync: vi.fn() }
    vi.mocked(useAddProviderCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useAddProviderCredential>)
    vi.mocked(useEditProviderCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useEditProviderCredential>)
    vi.mocked(useDeleteProviderCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useDeleteProviderCredential>)
    vi.mocked(useActiveProviderCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useActiveProviderCredential>)
    vi.mocked(useAddModelCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useAddModelCredential>)
    vi.mocked(useEditModelCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useEditModelCredential>)
    vi.mocked(useDeleteModelCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useDeleteModelCredential>)
    vi.mocked(useActiveModelCredential).mockReturnValue(mockMutationReturn as unknown as ReturnType<typeof useActiveModelCredential>)
  })

  it('useGetCredential selects correct source and params', () => {
    const mockData = { data: 'test' }
    vi.mocked(useGetProviderCredential).mockReturnValue(mockData as unknown as ReturnType<typeof useGetProviderCredential>)
    vi.mocked(useGetModelCredential).mockReturnValue(mockData as unknown as ReturnType<typeof useGetModelCredential>)

    // Provider case
    const { result: providerRes } = renderHook(() => useGetCredential('openai', false, 'cred-123'), { wrapper })
    expect(useGetProviderCredential).toHaveBeenCalledWith(true, 'openai', 'cred-123')
    expect(providerRes.current).toBe(mockData)

    // Model case
    const mockModel = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration } as CustomModel
    const { result: modelRes } = renderHook(() => useGetCredential('openai', true, 'cred-123', mockModel, 'src'), { wrapper })
    expect(useGetModelCredential).toHaveBeenCalledWith(true, 'openai', 'cred-123', 'gpt-4', ModelTypeEnum.textGeneration, 'src')
    expect(modelRes.current).toBe(mockData)

    // Early return cases
    renderHook(() => useGetCredential('openai', false), { wrapper })
    expect(useGetProviderCredential).toHaveBeenCalledWith(false, 'openai', undefined)

    // Branch: isModelCredential true but no id/model
    renderHook(() => useGetCredential('openai', true), { wrapper })
    expect(useGetModelCredential).toHaveBeenCalledWith(false, 'openai', undefined, undefined, undefined, undefined)
  })

  it('useAuthService provides correct services for provider and model', () => {
    const { result } = renderHook(() => useAuthService('openai'), { wrapper })

    // Provider services
    expect(result.current.getAddCredentialService(false)).toBe(vi.mocked(useAddProviderCredential).mock.results[0].value.mutateAsync)
    expect(result.current.getEditCredentialService(false)).toBe(vi.mocked(useEditProviderCredential).mock.results[0].value.mutateAsync)
    expect(result.current.getDeleteCredentialService(false)).toBe(vi.mocked(useDeleteProviderCredential).mock.results[0].value.mutateAsync)
    expect(result.current.getActiveCredentialService(false)).toBe(vi.mocked(useActiveProviderCredential).mock.results[0].value.mutateAsync)

    // Model services
    expect(result.current.getAddCredentialService(true)).toBe(vi.mocked(useAddModelCredential).mock.results[0].value.mutateAsync)
    expect(result.current.getEditCredentialService(true)).toBe(vi.mocked(useEditModelCredential).mock.results[0].value.mutateAsync)
    expect(result.current.getDeleteCredentialService(true)).toBe(vi.mocked(useDeleteModelCredential).mock.results[0].value.mutateAsync)
    expect(result.current.getActiveCredentialService(true)).toBe(vi.mocked(useActiveModelCredential).mock.results[0].value.mutateAsync)
  })
})
