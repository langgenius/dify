import type { Credential, CustomModelCredential, ModelProvider } from '../../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { useCredentialData } from './use-credential-data'

vi.mock('./use-auth-service', () => ({
  useGetCredential: vi.fn(),
}))

const { useGetCredential } = await import('./use-auth-service')

describe('useCredentialData', () => {
  let queryClient: QueryClient
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('determines correct config source and parameters', () => {
    vi.mocked(useGetCredential).mockReturnValue({ isLoading: false, data: {} } as unknown as ReturnType<typeof useGetCredential>)
    const mockProvider = { provider: 'openai' } as unknown as ModelProvider

    // Predefined source
    renderHook(() => useCredentialData(mockProvider, true), { wrapper })
    expect(useGetCredential).toHaveBeenCalledWith('openai', undefined, undefined, undefined, 'predefined-model')

    // Custom source
    renderHook(() => useCredentialData(mockProvider, false), { wrapper })
    expect(useGetCredential).toHaveBeenCalledWith('openai', undefined, undefined, undefined, 'custom-model')
  })

  it('returns appropriate loading and data states', () => {
    const mockData = { api_key: 'test' }
    vi.mocked(useGetCredential).mockReturnValue({ isLoading: true, data: undefined } as unknown as ReturnType<typeof useGetCredential>)
    const mockProvider = { provider: 'openai' } as unknown as ModelProvider

    const { result: loadingRes } = renderHook(() => useCredentialData(mockProvider, true), { wrapper })
    expect(loadingRes.current.isLoading).toBe(true)
    expect(loadingRes.current.credentialData).toEqual({})

    vi.mocked(useGetCredential).mockReturnValue({ isLoading: false, data: mockData } as unknown as ReturnType<typeof useGetCredential>)
    const { result: dataRes } = renderHook(() => useCredentialData(mockProvider, true), { wrapper })
    expect(dataRes.current.isLoading).toBe(false)
    expect(dataRes.current.credentialData).toBe(mockData)
  })

  it('passes credential and model identifier correctly', () => {
    vi.mocked(useGetCredential).mockReturnValue({ isLoading: false, data: {} } as unknown as ReturnType<typeof useGetCredential>)
    const mockProvider = { provider: 'openai' } as unknown as ModelProvider
    const mockCredential = { credential_id: 'cred-123' } as unknown as Credential
    const mockModel = { model: 'gpt-4' } as unknown as CustomModelCredential

    renderHook(() => useCredentialData(mockProvider, true, true, mockCredential, mockModel), { wrapper })
    expect(useGetCredential).toHaveBeenCalledWith('openai', true, 'cred-123', mockModel, 'predefined-model')
  })
})
