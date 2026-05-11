import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useApplyTagBindingsMutation } from '../use-tag-mutations'

const {
  bindTag,
  listKey,
  unbindTag,
} = vi.hoisted(() => ({
  bindTag: vi.fn(),
  listKey: vi.fn((options: { type: 'query', input: { query: { type: string } } }) => ['console', 'tags', 'list', 'query', options.input.query.type]),
  unbindTag: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    tags: {
      bind: bindTag,
      unbind: unbindTag,
    },
  },
  consoleQuery: {
    tags: {
      list: {
        key: listKey,
      },
    },
  },
}))

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
})

const renderMutationHook = <TResult,>(hook: () => TResult) => {
  const queryClient = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )

  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  }
}

describe('useTagMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bindTag.mockResolvedValue(undefined)
    unbindTag.mockResolvedValue(undefined)
  })

  describe('Apply Tag Bindings', () => {
    it('should bind added tags and unbind removed tags using batched request bodies', async () => {
      const { queryClient, result } = renderMutationHook(() => useApplyTagBindingsMutation())
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

      await act(async () => {
        await result.current.mutateAsync({
          currentTagIds: ['tag-1', 'tag-2'],
          nextTagIds: ['tag-2', 'tag-3', 'tag-4'],
          targetId: 'app-1',
          type: 'app',
        })
      })

      expect(bindTag).toHaveBeenCalledWith({
        body: {
          tag_ids: ['tag-3', 'tag-4'],
          target_id: 'app-1',
          type: 'app',
        },
      })
      expect(unbindTag).toHaveBeenCalledWith({
        body: {
          tag_ids: ['tag-1'],
          target_id: 'app-1',
          type: 'app',
        },
      })
      await waitFor(() => {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: ['console', 'tags', 'list', 'query', 'app'],
        })
      })
      expect(listKey).toHaveBeenCalledWith({
        type: 'query',
        input: {
          query: {
            type: 'app',
          },
        },
      })
    })

    it('should skip network requests when tag bindings do not change but still invalidate tags', async () => {
      const { queryClient, result } = renderMutationHook(() => useApplyTagBindingsMutation())
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

      await act(async () => {
        await result.current.mutateAsync({
          currentTagIds: ['tag-1'],
          nextTagIds: ['tag-1'],
          targetId: 'knowledge-1',
          type: 'knowledge',
        })
      })

      expect(bindTag).not.toHaveBeenCalled()
      expect(unbindTag).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: ['console', 'tags', 'list', 'query', 'knowledge'],
        })
      })
      expect(listKey).toHaveBeenCalledWith({
        type: 'query',
        input: {
          query: {
            type: 'knowledge',
          },
        },
      })
    })
  })
})
