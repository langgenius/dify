import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { get } from '../base'
import { useAppTriggers, useMCPServerDetail } from '../use-tools'

vi.mock('../base', () => ({
  get: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('use-tools query options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(get).mockResolvedValue({ data: [] })
  })

  // MCP server detail supports an explicit enabled flag.
  describe('MCP Server Detail', () => {
    it('should not fetch server detail when disabled', () => {
      renderHook(() => useMCPServerDetail('app-1', false), { wrapper: createWrapper() })

      expect(get).not.toHaveBeenCalled()
    })

    it('should fetch server detail when enabled', async () => {
      renderHook(() => useMCPServerDetail('app-1'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/apps/app-1/server')
      })
    })
  })

  // App trigger callers can override default query options such as enabled.
  describe('App Triggers', () => {
    it('should respect caller-provided enabled option', () => {
      renderHook(() => useAppTriggers('app-1', { enabled: false }), { wrapper: createWrapper() })

      expect(get).not.toHaveBeenCalled()
    })
  })
})
