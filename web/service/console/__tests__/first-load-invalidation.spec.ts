import type { MutationFunctionContext, QueryKey } from '@tanstack/react-query'
import { MutationCache, MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createMutationInvalidation } from '../mutation-invalidation'
import { invalidateQueryKeys } from '../policies/shared'

type List = { data: string[] }

const clients: QueryClient[] = []
const unsubscribers: Array<() => void> = []

afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

const annotationCountKey = (): QueryKey =>
  consoleQuery.apps.byAppId.annotations.count.get.queryKey({
    input: { params: { app_id: 'app-1' } },
  })

const annotationListKey = (): QueryKey =>
  consoleQuery.apps.byAppId.annotations.get.queryKey({
    input: { params: { app_id: 'app-1' }, query: { page: 1, limit: 10 } },
  })

/**
 * Mounts a list whose responses resolve only when the test says so, in the
 * order the test chooses.
 */
function mountList(queryKey: QueryKey, { withFallback = false } = {}) {
  const invalidation = createMutationInvalidation()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    ...(withFallback && {
      mutationCache: new MutationCache({
        onSuccess: (_data, _variables, _result, mutation) =>
          invalidation.onMutationSuccess(mutation),
      }),
    }),
  })
  clients.push(client)
  if (withFallback) unsubscribers.push(invalidation.attach(client))
  const responses: Array<ReturnType<typeof createDeferred<List>>> = []
  const queryFn = vi.fn(() => {
    const response = createDeferred<List>()
    responses.push(response)
    return response.promise
  })
  const observer = new QueryObserver<List>(client, { queryKey, queryFn })
  unsubscribers.push(observer.subscribe(() => undefined))
  const context: MutationFunctionContext = { client, meta: undefined }
  return { client, observer, queryFn, responses, context }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('invalidation during a first load', () => {
  it('reproduces the race: invalidateQueries alone keeps the response read before the write', async () => {
    const { client, observer, queryFn, responses } = mountList(annotationListKey())
    expect(queryFn).toHaveBeenCalledTimes(1)

    const invalidation = client.invalidateQueries({ queryKey: annotationListKey() })
    responses[0]!.resolve({ data: ['before write'] })
    await invalidation

    // The invalidation joined the in-flight first load instead of starting a new one.
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult().data).toEqual({ data: ['before write'] })
    expect(client.getQueryState(annotationListKey())?.isInvalidated).toBe(false)
  })

  it('restarts the first load so the list shows the write', async () => {
    const { observer, queryFn, responses, client } = mountList(annotationListKey())

    const invalidation = invalidateQueryKeys(client, [annotationListKey()])
    await settle()
    expect(queryFn).toHaveBeenCalledTimes(2)

    // The pre-write response arrives last and must not win.
    responses[1]!.resolve({ data: ['after write'] })
    responses[0]!.resolve({ data: ['before write'] })
    await invalidation
    await settle()

    expect(observer.getCurrentResult().data).toEqual({ data: ['after write'] })
  })

  it('keeps showing loaded data while a refetch restarts, without reverting', async () => {
    const { observer, queryFn, responses, client } = mountList(annotationListKey())
    responses[0]!.resolve({ data: ['loaded'] })
    await settle()
    const seen: Array<List | undefined> = []
    unsubscribers.push(observer.subscribe((result) => seen.push(result.data)))

    const invalidation = invalidateQueryKeys(client, [annotationListKey()])
    await settle()
    responses[1]!.resolve({ data: ['after write'] })
    await invalidation
    await settle()

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(seen.every((data) => data !== undefined)).toBe(true)
    expect(observer.getCurrentResult().data).toEqual({ data: ['after write'] })
  })
})

describe('annotation policies', () => {
  const params = { app_id: 'app-1' }

  it.each([
    ['create', () => consoleQuery.apps.byAppId.annotations.post.mutationOptions()],
    ['edit', () => consoleQuery.apps.byAppId.annotations.byAnnotationId.post.mutationOptions()],
    ['delete', () => consoleQuery.apps.byAppId.annotations.byAnnotationId.delete.mutationOptions()],
    ['batch delete', () => consoleQuery.apps.byAppId.annotations.delete.mutationOptions()],
  ])(
    '%s refreshes a list still on its first load with a post-write request',
    async (_, options) => {
      const { observer, queryFn, responses, context } = mountList(annotationListKey())
      const { onSettled } = options()

      const refresh = Promise.resolve(
        (onSettled as (...args: unknown[]) => unknown)(
          undefined,
          null,
          { params: { ...params, annotation_id: 'annotation-1' } },
          undefined,
          context,
        ),
      )
      await settle()
      responses[1]!.resolve({ data: ['after write'] })
      responses[0]!.resolve({ data: ['before write'] })
      await refresh
      await settle()

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(observer.getCurrentResult().data).toEqual({ data: ['after write'] })
    },
  )

  it.each([
    ['create', () => consoleQuery.apps.byAppId.annotations.post.mutationOptions()],
    ['delete', () => consoleQuery.apps.byAppId.annotations.byAnnotationId.delete.mutationOptions()],
    ['batch delete', () => consoleQuery.apps.byAppId.annotations.delete.mutationOptions()],
  ])('%s leaves the annotation quota to the fallback', async (_, options) => {
    const client = new QueryClient()
    clients.push(client)
    const invalidated = vi.spyOn(client, 'invalidateQueries')
    const { onSettled } = options()

    await (onSettled as (...args: unknown[]) => unknown)(
      undefined,
      null,
      { params: { ...params, annotation_id: 'annotation-1' } },
      undefined,
      { client, meta: undefined },
    )

    expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).not.toContainEqual(
      consoleQuery.features.get.key(),
    )
    expect(options().meta?.alsoInvalidate).toEqual(['features'])
  })

  it('does not refresh after a failed write', async () => {
    const client = new QueryClient()
    clients.push(client)
    const invalidated = vi.spyOn(client, 'invalidateQueries')
    const { onSettled } = consoleQuery.apps.byAppId.annotations.delete.mutationOptions()

    await (onSettled as (...args: unknown[]) => unknown)(
      undefined,
      new Error('failed'),
      { params },
      undefined,
      { client, meta: undefined },
    )

    expect(invalidated).not.toHaveBeenCalled()
  })

  // Export stays disabled while the count reads 0, so the count must not keep a
  // pre-write first load either.
  it('restarts a first load of the annotation count after an add', async () => {
    const { observer, queryFn, responses, context } = mountList(annotationCountKey())
    const { onSettled } = consoleQuery.apps.byAppId.annotations.post.mutationOptions()

    ;(onSettled as (...args: unknown[]) => unknown)(undefined, null, { params }, undefined, context)
    await settle()
    responses[1]!.resolve({ data: ['1 annotation'] })
    responses[0]!.resolve({ data: ['0 annotations'] })
    await settle()

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(observer.getCurrentResult().data).toEqual({ data: ['1 annotation'] })
  })

  it('waits for the annotation list on an add but not for the quota', async () => {
    const { client, queryFn, responses } = mountList(annotationListKey(), { withFallback: true })
    responses[0]!.resolve({ data: ['loaded'] })
    await settle()
    const quotaLoad = createDeferred<unknown>()
    const quotaFn = vi.fn().mockReturnValueOnce(quotaLoad.promise).mockResolvedValue({})
    const quota = new QueryObserver(client, {
      queryKey: consoleQuery.features.get.queryKey(),
      queryFn: quotaFn,
    })
    unsubscribers.push(quota.subscribe(() => undefined))
    await settle()

    let added = false
    const mutation = new MutationObserver(
      client,
      consoleQuery.apps.byAppId.annotations.post.mutationOptions({
        mutationFn: async () => ({ id: 'annotation-1' }) as never,
      }),
    )
    const adding = mutation
      .mutate({ params, body: { question: 'q', answer: 'a' } } as never)
      .then(() => {
        added = true
      })
    await settle()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(added).toBe(false)

    // The list lands; the quota's first load is still pending and does not hold the add.
    responses[1]!.resolve({ data: ['after write'] })
    await adding
    expect(added).toBe(true)
    // That observed load started before the write: the fallback restarts it.
    await vi.waitFor(() => expect(quotaFn).toHaveBeenCalledTimes(2))
    quotaLoad.resolve({})
    await vi.waitFor(() => expect(quota.getCurrentResult().isSuccess).toBe(true))
  })
})
