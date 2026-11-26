import type { InfiniteData, MutationFunctionContext, QueryKey } from '@tanstack/react-query'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'

type Callback = (...args: unknown[]) => unknown

const clients: QueryClient[] = []
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const context: MutationFunctionContext = { client, meta: undefined }
  return { client, context }
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

const profileKey = consoleQuery.account.profile.get.queryKey()

// Keeps the profile observed, so a reset refetches it and the policy waits for that.
function observeProfile(client: QueryClient) {
  const refetch = createDeferred<unknown>()
  const queryFn = vi.fn(() => refetch.promise)
  client.setQueryData(profileKey, { id: 'previous-account' } as never)
  const observer = new QueryObserver(client, { queryKey: profileKey, queryFn, staleTime: Infinity })
  const unsubscribe = observer.subscribe(() => undefined)
  return { refetch, queryFn, unsubscribe }
}

const track = (value: unknown) => {
  const state = { done: false }
  void Promise.resolve(value).then(() => {
    state.done = true
  })
  return state
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('sign-in policies', () => {
  const signIns = [
    ['login.post', consoleQuery.login.post],
    ['emailCodeLogin.validity.post', consoleQuery.emailCodeLogin.validity.post],
    ['emailRegister.post', consoleQuery.emailRegister.post],
  ] as const

  it.each(signIns)(
    '%s waits for the reloaded profile and skips the fallback',
    async (_name, procedure) => {
      const { client, context } = setup()
      const profile = observeProfile(client)
      const { onSuccess, meta } = procedure.mutationOptions()

      const state = track(
        (onSuccess as Callback)({ result: 'success' }, { body: {} }, undefined, context),
      )
      await settle()
      expect(client.getQueryData(profileKey)).toBeUndefined()
      expect(profile.queryFn).toHaveBeenCalledOnce()
      expect(state.done).toBe(false)

      profile.refetch.resolve({ id: 'signed-in-account' })
      await settle()
      expect(state.done).toBe(true)
      expect(client.getQueryData(profileKey)).toEqual({ id: 'signed-in-account' })
      expect(meta?.invalidate).toBe(false)
      profile.unsubscribe()
    },
  )

  it.each(signIns)('%s keeps the profile when the sign-in is refused', async (_name, procedure) => {
    const { client, context } = setup()
    const profile = observeProfile(client)

    await (procedure.mutationOptions().onSuccess as Callback)(
      { result: 'fail' },
      { body: {} },
      undefined,
      context,
    )

    expect(client.getQueryData(profileKey)).toEqual({ id: 'previous-account' })
    expect(profile.queryFn).not.toHaveBeenCalled()
    profile.unsubscribe()
  })

  it('waits for the reloaded profile after the first account setup', async () => {
    const { client, context } = setup()
    const profile = observeProfile(client)

    const state = track(
      (consoleQuery.account.init.post.mutationOptions().onSuccess as Callback)(
        { result: 'success' },
        { body: {} },
        undefined,
        context,
      ),
    )
    await settle()
    expect(profile.queryFn).toHaveBeenCalledOnce()
    expect(state.done).toBe(false)

    profile.refetch.resolve({ id: 'set-up-account' })
    await settle()
    expect(state.done).toBe(true)
    profile.unsubscribe()
  })

  it('marks the install finished once the init password is accepted', async () => {
    const { client, context } = setup()
    const statusKey = consoleQuery.init.get.queryKey()
    client.setQueryData(statusKey, { status: 'not_started' })

    await (consoleQuery.init.post.mutationOptions().onSuccess as Callback)(
      { result: 'success' },
      { body: { password: 'secret' } },
      undefined,
      context,
    )

    expect(client.getQueryData(statusKey)).toEqual({ status: 'finished' })
  })
})

describe('network access check run on save', () => {
  it('writes the check into the group check query', async () => {
    const { client, context } = setup()
    const checkCurrentIp =
      consoleQuery.workspaces.current.networkAccessGroups.byGroupId.checkCurrentIp.get
    const params = { group_id: 'group-1' }
    const check = { allowed: false, client_ip: '10.0.0.1', policy_version: 3 }

    await (checkCurrentIp.mutationOptions().onSuccess as Callback)(
      check,
      { params },
      undefined,
      context,
    )

    expect(client.getQueryData(checkCurrentIp.queryKey({ input: { params } }))).toEqual(check)
  })
})

describe('access rule delete', () => {
  it('removes the deleted rule from every resource rule list', async () => {
    const { client, context } = setup()
    const lists = consoleQuery.workspaces.current.rbac.workspace
    const page = (ids: string[]) => ({
      items: ids.map((id) => ({ policy: { id } })),
      pagination: { total_count: ids.length, current_page: 1, per_page: 20, total_pages: 1 },
    })
    const keys: QueryKey[] = [
      lists.apps.accessPolicy.get.infiniteKey({
        input: (pageParam: number) => ({ query: { language: 'en', page: pageParam } }),
        initialPageParam: 1,
      }),
      lists.datasets.accessPolicy.get.infiniteKey({
        input: (pageParam: number) => ({ query: { language: 'ja', page: pageParam } }),
        initialPageParam: 1,
      }),
    ]
    for (const key of keys)
      client.setQueryData(key, { pages: [page(['rule-1', 'rule-2'])], pageParams: [1] })

    const { onSuccess } =
      consoleQuery.workspaces.current.rbac.accessPolicies.byPolicyId.delete.mutationOptions()
    await (onSuccess as Callback)(
      undefined,
      { params: { policy_id: 'rule-1' } },
      undefined,
      context,
    )

    for (const key of keys)
      expect(client.getQueryData<InfiniteData<unknown>>(key)?.pages).toEqual([page(['rule-2'])])
  })
})

describe('human input channel writes', () => {
  const v2 = consoleQuery.workspaces.current.humanInput.v2
  const channelUpdate = v2.channels.email.byChannelId.put

  it('waits only for the channel list after a success', async () => {
    const { client, context } = setup()
    const invalidated = vi.spyOn(client, 'invalidateQueries')

    await (channelUpdate.mutationOptions().onSettled as Callback)(
      {},
      null,
      { params: { channel_id: 'channel-1' } },
      undefined,
      context,
    )

    expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      v2.channels.key(),
    ])
  })

  it('refreshes contacts and sync runs too after a failure', async () => {
    const { client, context } = setup()
    const invalidated = vi.spyOn(client, 'invalidateQueries')

    await (channelUpdate.mutationOptions().onSettled as Callback)(
      undefined,
      new Error('rejected'),
      { params: { channel_id: 'channel-1' } },
      undefined,
      context,
    )

    const keys = invalidated.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toContainEqual(v2.contacts.key())
    expect(keys).toContainEqual(v2.imSyncRuns.key())
    expect(keys).toContainEqual(v2.channels.key())
  })
})
