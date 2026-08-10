import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useBatchSyncDocuments, useBatchSyncNotion, useBatchSyncWebsite } from '../use-document'

// Mocked through the module path rather than an import binding: web/service/** may not import the
// legacy fetch helpers directly (no-restricted-imports in lint.config.ts).
const mockPost = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())

vi.mock('../../base', () => ({
  post: mockPost,
  get: mockGet,
  patch: vi.fn(),
  del: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('document sync hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ result: 'success' })
    mockGet.mockResolvedValue({ result: 'success' })
  })

  // Guards the bug this endpoint exists to fix: the batch action must sync the documents the user
  // selected, not every document in the knowledge base.
  it('should post the selected document ids to the batch-sync endpoint', async () => {
    const { result } = renderHook(() => useBatchSyncDocuments(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({ datasetId: 'ds1', documentIds: ['doc1', 'doc2'] })
    })

    expect(mockPost).toHaveBeenCalledWith('/datasets/ds1/documents/batch-sync', {
      body: { document_ids: ['doc1', 'doc2'] },
    })
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('should sync the whole dataset for Notion Sync All', async () => {
    const { result } = renderHook(() => useBatchSyncNotion(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({ datasetId: 'ds1' })
    })

    expect(mockGet).toHaveBeenCalledWith('/datasets/ds1/notion/sync')
  })

  it('should sync the whole dataset for website Sync All', async () => {
    const { result } = renderHook(() => useBatchSyncWebsite(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({ datasetId: 'ds1' })
    })

    expect(mockGet).toHaveBeenCalledWith('/datasets/ds1/website-sync')
  })
})
