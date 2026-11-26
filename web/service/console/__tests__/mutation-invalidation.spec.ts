import type { MutationKey, MutationMeta, QueryKey } from '@tanstack/react-query'
import { MutationCache, MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createMutationInvalidation, domainOf } from '../mutation-invalidation'

const cleanups: Array<() => void> = []

beforeEach(() => {
  // Freshness is compared by timestamp; each step gets its own millisecond.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const tick = () => vi.setSystemTime(Date.now() + 1)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function createClient() {
  const invalidation = createMutationInvalidation()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _result, mutation) => invalidation.onMutationSuccess(mutation),
    }),
  })
  cleanups.push(invalidation.attach(client), () => client.clear())
  return client
}

/** An observed query whose fetches resolve at once with the fetch count. */
async function mountQuery(client: QueryClient, queryKey: QueryKey) {
  const queryFn = vi.fn(async () => queryFn.mock.calls.length)
  const observer = new QueryObserver(client, { queryKey, queryFn })
  cleanups.push(observer.subscribe(() => undefined))
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
  tick()
  return queryFn
}

type MutationSpec = {
  mutationKey?: MutationKey
  meta?: MutationMeta
  mutationFn?: () => Promise<unknown>
  onSuccess?: () => unknown
}

function mutate(client: QueryClient, spec: MutationSpec) {
  const observer = new MutationObserver(client, { mutationFn: async () => 'ok', ...spec })
  return observer.mutate(undefined)
}

const appsListKey = () => consoleQuery.apps.get.queryKey({ input: { query: { page: 1 } } })
const appDetailKey = (): QueryKey =>
  consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } })
const datasetsListKey = () => consoleQuery.datasets.get.queryKey({ input: { query: {} } })
const membersKey = () => consoleQuery.workspaces.current.members.get.queryKey()
const featuresKey = () => consoleQuery.features.get.queryKey()
const renameApp = () => consoleQuery.apps.byAppId.put.mutationKey()

describe('domainOf', () => {
  it('uses the first segment, or the resource under workspaces.current and enterprise', () => {
    expect(domainOf(['apps', 'byAppId', 'patch'])).toBe('apps')
    expect(domainOf(['enterprise', 'appDeploy', 'deploymentService', 'deployWorkflow'])).toBe(
      'enterprise.appDeploy',
    )
    expect(domainOf(['workspaces', 'current', 'members', 'byMemberId', 'delete'])).toBe(
      'workspaces.current.members',
    )
  })
})

describe('mutation invalidation fallback', () => {
  it("refreshes the active queries of the mutation's domain and leaves other domains alone", async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const appDetail = await mountQuery(client, appDetailKey())
    const datasets = await mountQuery(client, datasetsListKey())

    await mutate(client, { mutationKey: renameApp() })
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
    expect(appDetail).toHaveBeenCalledTimes(2)
    expect(datasets).toHaveBeenCalledTimes(1)
  })

  it('does not hold the mutation until the refresh lands', async () => {
    const client = createClient()
    const refetch = createDeferred<string>()
    const queryFn = vi.fn().mockResolvedValueOnce('first').mockReturnValueOnce(refetch.promise)
    const observer = new QueryObserver(client, { queryKey: appsListKey(), queryFn })
    cleanups.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('first'))
    tick()

    await mutate(client, { mutationKey: renameApp() })

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(observer.getCurrentResult().data).toBe('first')
    refetch.resolve('second')
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('second'))
  })

  it('skips queries the policy already refreshed or wrote after the request succeeded', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const appDetail = await mountQuery(client, appDetailKey())

    await mutate(client, {
      mutationKey: renameApp(),
      onSuccess: () => {
        tick()
        client.setQueryData(appDetailKey(), 'from response')
      },
    })
    await settle()

    expect(appDetail).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(appDetailKey())).toBe('from response')
    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('restarts a read that started before the write even when the policy wrote the response', async () => {
    const client = createClient()
    const staleRead = createDeferred<string>()
    const queryFn = vi.fn().mockReturnValueOnce(staleRead.promise).mockResolvedValue('fresh')
    // An unobserved read that started before the write: invalidation alone would let it land.
    void client.query({ queryKey: appDetailKey(), queryFn }).catch(() => undefined)
    tick()

    await mutate(client, {
      mutationKey: renameApp(),
      onSuccess: () => {
        tick()
        client.setQueryData(appDetailKey(), 'from response')
      },
    })
    await settle()
    staleRead.resolve('stale')
    await settle()

    expect(client.getQueryData(appDetailKey())).not.toBe('stale')
  })

  it('refreshes data from the same millisecond as the success', async () => {
    const client = createClient()
    const queryFn = vi.fn(async () => queryFn.mock.calls.length)
    const observer = new QueryObserver(client, { queryKey: appsListKey(), queryFn })
    cleanups.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

    await mutate(client, { mutationKey: renameApp() })
    await settle()

    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('refreshes the domains a policy declares in alsoInvalidate', async () => {
    const client = createClient()
    const features = await mountQuery(client, featuresKey())

    await mutate(client, {
      mutationKey: consoleQuery.apps.post.mutationKey(),
      meta: { alsoInvalidate: ['features'] },
    })
    await settle()

    expect(features).toHaveBeenCalledTimes(2)
  })

  it('scopes workspaces.current writes to their own resource', async () => {
    const client = createClient()
    const members = await mountQuery(client, membersKey())
    const models = await mountQuery(
      client,
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type: 'llm' } },
      }),
    )

    await mutate(client, {
      mutationKey: consoleQuery.workspaces.current.members.byMemberId.delete.mutationKey(),
    })
    await settle()

    expect(members).toHaveBeenCalledTimes(2)
    expect(models).toHaveBeenCalledTimes(1)
  })

  it.each<[string, MutationSpec]>([
    [
      'opted out with meta.invalidate: false',
      { mutationKey: renameApp(), meta: { invalidate: false } },
    ],
    ['a read run as a mutation', { mutationKey: consoleQuery.apps.byAppId.get.mutationKey() }],
    ['without a console key', { mutationKey: ['tag-bindings', 'apply'] }],
    ['without a key', {}],
  ])('does nothing for a mutation %s', async (_name, spec) => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())

    await mutate(client, spec)
    await settle()

    expect(appsList).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the request fails', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())

    await expect(
      mutate(client, {
        mutationKey: renameApp(),
        mutationFn: () => Promise.reject(new Error('no')),
      }),
    ).rejects.toThrow('no')
    await settle()

    expect(appsList).toHaveBeenCalledTimes(1)
  })

  it('still refreshes when a callback throws after the request succeeded', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())

    await expect(
      mutate(client, {
        mutationKey: renameApp(),
        onSuccess: () => Promise.reject(new Error('refetch failed')),
      }),
    ).rejects.toThrow('refetch failed')
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('waits for the last pending mutation of the domain, then refreshes once for all', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const features = await mountQuery(client, featuresKey())
    const second = createDeferred<string>()

    const first = mutate(client, {
      mutationKey: renameApp(),
      meta: { alsoInvalidate: ['features'] },
    })
    const pending = mutate(client, { mutationKey: renameApp(), mutationFn: () => second.promise })
    await first
    await settle()

    // A refetch now could land on the pending write's optimistic value.
    expect(appsList).toHaveBeenCalledTimes(1)
    expect(features).toHaveBeenCalledTimes(1)

    tick()
    second.resolve('ok')
    await pending
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
    expect(features).toHaveBeenCalledTimes(2)
  })

  it('flushes the recorded refresh when the last pending sibling fails', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const second = createDeferred<string>()

    const first = mutate(client, { mutationKey: renameApp() })
    const pending = mutate(client, { mutationKey: renameApp(), mutationFn: () => second.promise })
    await first
    second.reject(new Error('no'))
    await expect(pending).rejects.toThrow('no')
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('does not wait for a pending mutation of another domain or one that opts out', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const never = createDeferred<string>()

    void mutate(client, {
      mutationKey: consoleQuery.datasets.post.mutationKey(),
      mutationFn: () => never.promise,
    })
    void mutate(client, {
      mutationKey: renameApp(),
      meta: { invalidate: false },
      mutationFn: () => never.promise,
    })
    await mutate(client, { mutationKey: renameApp() })
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
  })
})
