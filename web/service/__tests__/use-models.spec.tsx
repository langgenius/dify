import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderHook } from '@/test/console/render'
import { useDeleteProviderCredential } from '../use-models'

const { mockDel } = vi.hoisted(() => ({
  mockDel: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  del: mockDel,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useDeleteProviderCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDel.mockResolvedValue({ result: 'success' })
  })

  it('sends credential_id as a DELETE query parameter', async () => {
    const credentialId = '123e4567-e89b-12d3-a456-426614174000'
    const { result } = renderHook(() => useDeleteProviderCredential('openai'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({ credential_id: credentialId })
    })

    expect(mockDel).toHaveBeenCalledWith('/workspaces/current/model-providers/openai/credentials', {
      params: {
        credential_id: credentialId,
      },
    })
  })
})
