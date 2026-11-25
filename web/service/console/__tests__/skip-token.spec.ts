/**
 * Pins how `@orpc/tanstack-query` handles `input: skipToken`, including the local patch in
 * `patches/@orpc__tanstack-query@1.16.2.patch`:
 * - `queryFn` is TanStack's `skipToken`, so the query stays disabled even when a caller or a
 *   query policy passes `enabled: true`, and `refetch()` cannot run it.
 * - Skipped queries get their own key (backport of middleapi/orpc#2210), so they never share a
 *   cache entry with the same procedure called without input.
 */
import type { Client } from '@orpc/client'
import type { InfiniteData } from '@tanstack/react-query'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import {
  hashKey,
  InfiniteQueryObserver,
  partialMatchKey,
  QueryClient,
  QueryObserver,
  skipToken,
} from '@tanstack/react-query'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test'

type PlanetInput = { search?: string } | undefined
type Planet = { name: string }

const clients: QueryClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

function setup({ defaults = false } = {}) {
  const client = vi.fn(async (input: PlanetInput) => [{ name: input?.search ?? 'all' }])
  const utils = createTanstackQueryUtils(
    client as unknown as Client<Record<never, never>, PlanetInput, Planet[], Error>,
    {
      path: ['planet', 'list'],
      // Shaped like the defaults in service/console/query-policies.ts.
      ...(defaults
        ? { experimental_defaults: { queryOptions: { enabled: true, staleTime: 1234 } } }
        : {}),
    },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(queryClient)
  return { client, queryClient, utils }
}

function observe<T extends { subscribe: (listener: () => void) => () => void }>(observer: T) {
  const unsubscribe = observer.subscribe(() => {})
  onTestFinished(unsubscribe)
  return observer
}

describe('queryOptions with skipToken', () => {
  it('uses TanStack skipToken as queryFn', () => {
    const { utils } = setup()
    expect(utils.queryOptions({ input: skipToken }).queryFn).toBe(skipToken)
    expect(utils.queryOptions({ input: { search: 'a' } }).queryFn).toBeTypeOf('function')
  })

  it('stays disabled when the caller passes enabled: true', async () => {
    const { client, queryClient, utils } = setup()
    const observer = observe(
      new QueryObserver(queryClient, {
        ...utils.queryOptions({ input: skipToken }),
        enabled: true,
      }),
    )
    await Promise.resolve()
    expect(observer.getCurrentResult()).toMatchObject({
      status: 'pending',
      fetchStatus: 'idle',
      error: null,
    })
    await observer.refetch()
    expect(client).not.toHaveBeenCalled()
  })

  it('stays disabled when query defaults pass enabled: true, and keeps the other defaults', () => {
    const { client, queryClient, utils } = setup({ defaults: true })
    const skipped = utils.queryOptions({ input: skipToken })
    expect((skipped as { staleTime?: unknown }).staleTime).toBe(1234)
    const observer = observe(new QueryObserver(queryClient, skipped))
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    expect(client).not.toHaveBeenCalled()
  })

  it('keeps select and the data type for the unskipped branch', async () => {
    const { queryClient, utils } = setup()
    const search: string | undefined = 'mars'
    const options = utils.queryOptions({
      input: search ? { search } : skipToken,
      select: (planets) => planets.map((planet) => planet.name),
    })
    const observer = observe(new QueryObserver(queryClient, options))
    expectTypeOf(observer.getCurrentResult().data).toEqualTypeOf<string[] | undefined>()
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(['mars']))
  })

  it('gives skipped queries their own key that still matches partial keys', () => {
    const { utils } = setup()
    const skippedKey = utils.queryKey({ input: skipToken })
    expect(skippedKey).toEqual([['planet', 'list'], { skipToken: true, type: 'query' }])
    expect(hashKey(skippedKey)).not.toBe(hashKey(utils.queryKey({ input: undefined })))
    expect(utils.queryOptions({ input: skipToken }).queryKey).toEqual(skippedKey)
    expect(partialMatchKey(skippedKey, utils.key())).toBe(true)
    expect(partialMatchKey(skippedKey, utils.key({ type: 'query' }))).toBe(true)
    expect(partialMatchKey(skippedKey, utils.key({ input: { search: 'a' } }))).toBe(false)
  })

  it('does not break an unskipped query of the same procedure on invalidation', async () => {
    const { client, queryClient, utils } = setup()
    const unskipped = observe(
      new QueryObserver(queryClient, utils.queryOptions({ input: undefined })),
    )
    await vi.waitFor(() => expect(unskipped.getCurrentResult().status).toBe('success'))
    observe(new QueryObserver(queryClient, utils.queryOptions({ input: skipToken })))
    expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
    await queryClient.invalidateQueries({ queryKey: utils.key() })
    expect(unskipped.getCurrentResult().status).toBe('success')
    expect(client).toHaveBeenCalledTimes(2)
  })

  // `queryClient.query` is what the deprecated ensureQueryData / prefetchQuery forward to.
  it('never calls the client when the options are fetched imperatively', async () => {
    const { client, queryClient, utils } = setup()
    // TanStack reports invoking a skipToken queryFn as a configuration error.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const options = utils.queryOptions({ input: skipToken })
    await expect(queryClient.query({ ...options, staleTime: 'static' })).rejects.toThrow(
      'Missing queryFn',
    )
    await expect(queryClient.query(options)).rejects.toThrow('Missing queryFn')
    expect(client).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Attempted to invoke queryFn when set to skipToken'),
    )
  })
})

describe('infiniteOptions with skipToken', () => {
  it('uses TanStack skipToken as queryFn and stays disabled with enabled: true', async () => {
    const { client, queryClient, utils } = setup()
    const options = utils.infiniteOptions({
      input: skipToken,
      initialPageParam: 0,
      getNextPageParam: () => undefined,
    })
    expect(options.queryFn).toBe(skipToken)
    expect(options.queryKey).toEqual([['planet', 'list'], { skipToken: true, type: 'infinite' }])
    const observer = observe(new InfiniteQueryObserver(queryClient, { ...options, enabled: true }))
    expectTypeOf(observer.getCurrentResult().data).toEqualTypeOf<
      InfiniteData<Planet[], number> | undefined
    >()
    await observer.refetch()
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    expect(client).not.toHaveBeenCalled()
  })
})

describe('experimental streamed and live options with skipToken', () => {
  it('use TanStack skipToken as queryFn', () => {
    const { utils } = setup()
    expect(utils.experimental_streamedOptions({ input: skipToken }).queryFn).toBe(skipToken)
    expect(utils.experimental_liveOptions({ input: skipToken }).queryFn).toBe(skipToken)
  })
})
