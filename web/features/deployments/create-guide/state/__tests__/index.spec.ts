import type { Getter } from 'jotai'
import { atom, createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'

vi.mock('jotai-tanstack-query', () => ({
  atomWithInfiniteQuery: (createOptions: (get: Getter) => Record<string, unknown>) => atom((get) => {
    const options = createOptions(get)

    return {
      ...options,
      data: { pages: [{ data: [] }] },
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: false,
      fetchNextPage: vi.fn(),
    }
  }),
  atomWithMutation: () => atom(() => ({
    isPending: false,
    mutateAsync: vi.fn(),
  })),
  atomWithQuery: (createOptions: (get: Getter) => Record<string, unknown>) => atom(get => ({
    ...createOptions(get),
    data: undefined,
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: false,
  })),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      list: {
        infiniteOptions: (options: Record<string, unknown>) => ({
          ...options,
          queryKey: ['apps', 'list'],
        }),
      },
    },
  },
}))

async function loadState() {
  return await import('../index')
}

describe('create deployment guide state', () => {
  it('should keep the guide on source app mode when DSL import is disabled', async () => {
    const state = await loadState()
    const store = createStore()

    store.set(state.selectMethodAtom, 'importDsl')

    expect(store.get(state.methodAtom)).toBe('bindApp')
    expect(store.get(state.effectiveMethodAtom)).toBe('bindApp')
  })

  it('should keep source app loading enabled if stale state points to DSL import', async () => {
    const state = await loadState()
    const store = createStore()

    store.set(state.methodAtom, 'importDsl')

    const sourceAppsQuery = store.get(state.sourceAppsQueryAtom) as unknown as { enabled?: boolean }

    expect(store.get(state.effectiveMethodAtom)).toBe('bindApp')
    expect(sourceAppsQuery.enabled).toBe(true)
  })
})
