import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderHook } from '@/test/console/render'
import { useAllToolProviders, useDeleteMCP, useRefreshMCPServerCode } from '../use-tools'

const { mockDel, mockGet, mockPost } = vi.hoisted(() => ({
  mockDel: vi.fn(),
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  del: mockDel,
  get: mockGet,
  post: mockPost,
  put: vi.fn(),
}))

vi.mock('@/service/console', () => ({
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

describe('useDeleteMCP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends provider_id as a DELETE query parameter', async () => {
    const providerId = '123e4567-e89b-12d3-a456-426614174000'
    const { result } = renderHook(() => useDeleteMCP({}), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync(providerId)
    })

    expect(mockDel).toHaveBeenCalledWith('/workspaces/current/tool-provider/mcp', {
      params: {
        provider_id: providerId,
      },
    })
  })
})

describe('useAllToolProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue([])
  })

  it('keeps filtered MCP providers in a separate query', async () => {
    renderHook(
      () => {
        useAllToolProviders()
        useAllToolProviders(true, 'mcp')
      },
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
    expect(mockGet).toHaveBeenCalledWith('/workspaces/current/tool-providers')
    expect(mockGet).toHaveBeenCalledWith('/workspaces/current/tool-providers', {
      params: { type: 'mcp' },
    })
  })
})
