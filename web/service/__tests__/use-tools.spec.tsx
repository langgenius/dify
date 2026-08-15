import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderHook } from '@/test/console/render'
import { useRefreshMCPServerCode } from '../use-tools'

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  del: vi.fn(),
  get: mockGet,
  post: mockPost,
  put: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        server: {
          refresh: {
            post: mockPost,
          },
        },
      },
    },
  },
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

describe('useRefreshMCPServerCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes the MCP server with POST and the app ID', async () => {
    mockPost.mockResolvedValue({ id: 'server-1', server_code: 'new-code' })
    const { result } = renderHook(() => useRefreshMCPServerCode(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync('app-1')
    })

    expect(mockPost).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
      },
    })
    expect(mockGet).not.toHaveBeenCalled()
  })
})
