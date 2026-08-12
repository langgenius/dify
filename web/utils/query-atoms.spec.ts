import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { atomWithResolvedSuspenseQuery } from './query-atoms'

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

describe('atomWithResolvedSuspenseQuery', () => {
  it('should return the resolved suspense query result when query data is cached', () => {
    const queryClient = createQueryClient()
    const queryKey = ['resolved-query']
    queryClient.setQueryData(queryKey, 'cached data')

    const queryAtom = atomWithResolvedSuspenseQuery(
      () => ({
        queryKey,
        queryFn: async () => 'fetched data',
      }),
      () => queryClient,
    )
    const store = createStore()

    const result = store.get(queryAtom)

    expect(result.data).toBe('cached data')
    expect(result.isSuccess).toBe(true)
  })

  it('should throw when the suspense query is still pending', () => {
    const queryClient = createQueryClient()
    const queryKey = ['pending-query']
    const queryFn = vi.fn(() => new Promise<string>(() => {}))

    const queryAtom = atomWithResolvedSuspenseQuery(
      () => ({
        queryKey,
        queryFn,
      }),
      () => queryClient,
    )
    const store = createStore()

    expect(() => store.get(queryAtom)).toThrow(
      'Suspense query must be resolved before reading: ["pending-query"]',
    )
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('should keep the wrapped suspense query atom writable', () => {
    const queryClient = createQueryClient()
    const queryKey = ['writable-query']
    queryClient.setQueryData(queryKey, 'cached data')

    const queryAtom = atomWithResolvedSuspenseQuery(
      () => ({
        queryKey,
        queryFn: async () => 'fetched data',
      }),
      () => queryClient,
    )
    const store = createStore()

    expect(() => store.set(queryAtom)).not.toThrow()
  })
})
