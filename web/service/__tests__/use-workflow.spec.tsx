import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useUpdateWorkflow } from '../use-workflow'
import { appWorkflowVersionsInfiniteQueryKey } from '../workflow-queries'

const mockPatch = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: (...args: unknown[]) => mockPatch(...args),
  post: vi.fn(),
  put: vi.fn(),
}))

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

describe('useUpdateWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPatch.mockResolvedValue({})
  })

  it('should invalidate workflow version history after updating version information', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        url: '/apps/app-1/workflows/workflow-1',
        title: 'Release 1',
        releaseNotes: 'Notes',
      })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workflow', 'versionHistory'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: appWorkflowVersionsInfiniteQueryKey(),
    })
  })
})
