import type { ReactNode } from 'react'
import type { ProviderCredential } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useDeleteProviderCredential, useGetProviderCredential } from '../use-models'

const { mockDel, mockGet } = vi.hoisted(() => ({
  mockDel: vi.fn(),
  mockGet: vi.fn(),
}))

vi.mock('../base', () => ({
  del: mockDel,
  get: mockGet,
  post: vi.fn(),
  put: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
        staleTime: 1000 * 60 * 5,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
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

describe('useDeleteProviderCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDel.mockResolvedValue({ result: 'success' })
  })

  it('sends the credential_id as query params and omits the request body', async () => {
    const { result } = renderHook(() => useDeleteProviderCredential('openai'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({ credential_id: 'cred-1' })
    })

    expect(mockDel).toHaveBeenCalledWith('/workspaces/current/model-providers/openai/credentials', {
      params: { credential_id: 'cred-1' },
    })
    const [, options] = mockDel.mock.calls[0]!
    expect(options).not.toHaveProperty('body')
  })
})
