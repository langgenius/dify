import type { ReactNode } from 'react'
import type { Tag } from '@/contract/console/tags'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  useApplyTagBindingsMutation,
  useCreateTagMutation,
  useDeleteTagMutation,
  useUpdateTagMutation,
} from '../use-tag-mutations'

const {
  bindTag,
  createTagMutationOptions,
  deleteTagMutationOptions,
  listQueryOptions,
  unbindTag,
  updateTagMutationOptions,
} = vi.hoisted(() => ({
  bindTag: vi.fn(),
  createTagMutationOptions: vi.fn(),
  deleteTagMutationOptions: vi.fn(),
  listQueryOptions: vi.fn((options: { input: { query: { type: string } } }) => ({
    queryKey: ['console', 'tags', 'list', options.input.query.type],
  })),
  unbindTag: vi.fn(),
  updateTagMutationOptions: vi.fn(),
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
      create: {
        mutationOptions: createTagMutationOptions,
      },
      update: {
        mutationOptions: updateTagMutationOptions,
      },
      delete: {
        mutationOptions: deleteTagMutationOptions,
      },
      list: {
        queryOptions: listQueryOptions,
      },
    },
  },
}))

const appTag = (overrides: Partial<Tag> = {}): Tag => ({
  id: 'tag-1',
  name: 'Frontend',
  type: 'app',
  binding_count: 1,
  ...overrides,
})

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
    createTagMutationOptions.mockImplementation((options: Record<string, unknown>) => ({
      mutationFn: ({ body }: { body: { name: string, type: Tag['type'] } }) => Promise.resolve(appTag({
        id: 'created-tag',
        name: body.name,
        type: body.type,
        binding_count: 0,
      })),
      ...options,
    }))
    updateTagMutationOptions.mockImplementation((options: Record<string, unknown>) => ({
      mutationFn: () => Promise.resolve({ result: 'success' }),
      ...options,
    }))
    deleteTagMutationOptions.mockImplementation((options: Record<string, unknown>) => ({
      mutationFn: () => Promise.resolve({ result: 'success' }),
      ...options,
    }))
  })

  describe('Create Tag', () => {
    it('should prepend the created tag to the matching tag list cache', async () => {
      const { queryClient, result } = renderMutationHook(() => useCreateTagMutation())
      const cacheKey = ['console', 'tags', 'list', 'app']
      queryClient.setQueryData<Tag[]>(cacheKey, [
        appTag({ id: 'existing-tag', name: 'Existing' }),
      ])

      await act(async () => {
        await result.current.mutateAsync({
          body: {
            name: 'Created',
            type: 'app',
          },
        })
      })

      expect(queryClient.getQueryData<Tag[]>(cacheKey)).toEqual([
        appTag({ id: 'created-tag', name: 'Created', binding_count: 0 }),
        appTag({ id: 'existing-tag', name: 'Existing' }),
      ])
      expect(listQueryOptions).toHaveBeenCalledWith({
        input: {
          query: {
            type: 'app',
          },
        },
      })
    })

    it('should leave an absent tag list cache absent after creating a tag', async () => {
      const { queryClient, result } = renderMutationHook(() => useCreateTagMutation())
      const cacheKey = ['console', 'tags', 'list', 'knowledge']

      await act(async () => {
        await result.current.mutateAsync({
          body: {
            name: 'Knowledge',
            type: 'knowledge',
          },
        })
      })

      expect(queryClient.getQueryData<Tag[]>(cacheKey)).toBeUndefined()
    })
  })

  describe('Update Tag', () => {
    it('should rename only the matching tag in the matching tag list cache', async () => {
      const { queryClient, result } = renderMutationHook(() => useUpdateTagMutation('app'))
      const appCacheKey = ['console', 'tags', 'list', 'app']
      const knowledgeCacheKey = ['console', 'tags', 'list', 'knowledge']
      queryClient.setQueryData<Tag[]>(appCacheKey, [
        appTag({ id: 'tag-1', name: 'Old name' }),
        appTag({ id: 'tag-2', name: 'Unchanged' }),
      ])
      queryClient.setQueryData<Tag[]>(knowledgeCacheKey, [
        appTag({ id: 'tag-1', name: 'Old knowledge name', type: 'knowledge' }),
      ])

      await act(async () => {
        await result.current.mutateAsync({
          params: {
            tagId: 'tag-1',
          },
          body: {
            name: 'Renamed',
          },
        })
      })

      expect(queryClient.getQueryData<Tag[]>(appCacheKey)).toEqual([
        appTag({ id: 'tag-1', name: 'Renamed' }),
        appTag({ id: 'tag-2', name: 'Unchanged' }),
      ])
      expect(queryClient.getQueryData<Tag[]>(knowledgeCacheKey)).toEqual([
        appTag({ id: 'tag-1', name: 'Old knowledge name', type: 'knowledge' }),
      ])
    })
  })

  describe('Delete Tag', () => {
    it('should remove the deleted tag from the matching tag list cache', async () => {
      const { queryClient, result } = renderMutationHook(() => useDeleteTagMutation('app'))
      const cacheKey = ['console', 'tags', 'list', 'app']
      queryClient.setQueryData<Tag[]>(cacheKey, [
        appTag({ id: 'tag-1' }),
        appTag({ id: 'tag-2', name: 'Backend' }),
      ])

      await act(async () => {
        await result.current.mutateAsync({
          params: {
            tagId: 'tag-1',
          },
        })
      })

      expect(queryClient.getQueryData<Tag[]>(cacheKey)).toEqual([
        appTag({ id: 'tag-2', name: 'Backend' }),
      ])
    })
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
          queryKey: ['console', 'tags', 'list', 'app'],
        })
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
          queryKey: ['console', 'tags', 'list', 'knowledge'],
        })
      })
    })
  })
})
