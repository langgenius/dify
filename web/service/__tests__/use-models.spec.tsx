import type { ReactNode } from 'react'
import type { ProviderCredential } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useGetProviderCredential } from '../use-models'

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  del: vi.fn(),
  get: mockGet,
  post: vi.fn(),
  put: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 1000 * 60 * 5,
      },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useGetProviderCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should refetch credential details after the editor is reopened', async () => {
    const previousCredential: ProviderCredential = {
      credential_id: 'credential-id',
      name: 'Tongyi',
      credentials: {
        api_key: '[__HIDDEN__]',
        endpoint: 'https://old.example.com',
        enable_request_metadata: false,
      },
    }
    const updatedCredential: ProviderCredential = {
      ...previousCredential,
      credentials: {
        api_key: '[__HIDDEN__]',
        endpoint: 'https://new.example.com',
        enable_request_metadata: true,
      },
    }
    mockGet.mockResolvedValueOnce(previousCredential).mockResolvedValueOnce(updatedCredential)
    const wrapper = createWrapper()

    const firstEditor = renderHook(
      () => useGetProviderCredential(true, 'langgenius/tongyi/tongyi', 'credential-id'),
      { wrapper },
    )
    await waitFor(() => {
      expect(firstEditor.result.current.data).toEqual(previousCredential)
    })
    firstEditor.unmount()

    const reopenedEditor = renderHook(
      () => useGetProviderCredential(true, 'langgenius/tongyi/tongyi', 'credential-id'),
      { wrapper },
    )

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2)
      expect(reopenedEditor.result.current.data).toEqual(updatedCredential)
    })
  })
})
