import type { InfiniteData, MutationFunctionContext, QueryKey } from '@tanstack/react-query'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { pluginTaskListInput } from '@/service/console/plugin-task-cache'
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
  it('leaves the result to the save attempt that asked for it', () => {
    // A check whose popover was dismissed resolves late; only the caller knows its attempt is
    // stale, so the shared policy must not write the result.
    const { onSuccess } =
      consoleQuery.workspaces.current.networkAccessGroups.byGroupId.checkCurrentIp.get.mutationOptions()
    expect(onSuccess).toBeUndefined()
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

  it('drops the total on every page when the rule is on a later page', async () => {
    const { client, context } = setup()
    const key: QueryKey =
      consoleQuery.workspaces.current.rbac.workspace.apps.accessPolicy.get.infiniteKey({
        input: (pageParam: number) => ({ query: { language: 'en', page: pageParam } }),
        initialPageParam: 1,
      })
    const page = (ids: string[], current_page: number) => ({
      items: ids.map((id) => ({ policy: { id } })),
      pagination: { total_count: 3, current_page, per_page: 2, total_pages: 2 },
    })
    client.setQueryData(key, {
      pages: [page(['rule-1', 'rule-2'], 1), page(['rule-3'], 2)],
      pageParams: [1, 2],
    })

    const { onSuccess } =
      consoleQuery.workspaces.current.rbac.accessPolicies.byPolicyId.delete.mutationOptions()
    await (onSuccess as Callback)(
      undefined,
      { params: { policy_id: 'rule-3' } },
      undefined,
      context,
    )

    // The section shows the first page's total.
    const pages = client.getQueryData<InfiniteData<ReturnType<typeof page>>>(key)?.pages
    expect(pages?.map((item) => item.pagination.total_count)).toEqual([2, 2])
    expect(pages?.[1]?.items).toEqual([])
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

describe('policy writes over a read already in flight', () => {
  type Case = [string, () => unknown, QueryKey, unknown, unknown, unknown, unknown]
  const workspace = consoleQuery.workspaces.current
  it.each<Case>([
    [
      'init status after setup',
      () => consoleQuery.init.post.mutationOptions().onSuccess,
      consoleQuery.init.get.queryKey(),
      { status: 'not_started' },
      { result: 'success' },
      { body: { password: 'secret' } },
      { status: 'finished' },
    ],
    [
      'API extension list after a delete',
      () => consoleQuery.apiBasedExtension.byId.delete.mutationOptions().onSuccess,
      consoleQuery.apiBasedExtension.get.queryKey(),
      [{ id: 'ext-1' }, { id: 'ext-2' }],
      undefined,
      { params: { id: 'ext-1' } },
      [{ id: 'ext-2' }],
    ],
    [
      'latest IM sync run after a sync starts',
      () => workspace.humanInput.v2.imSyncRuns.post.mutationOptions().onSuccess,
      workspace.humanInput.v2.imSyncRuns.latest.get.queryKey(),
      { id: 'run-1' },
      { id: 'run-2' },
      {},
      { id: 'run-2' },
    ],
    [
      'tour state after a patch',
      () => consoleQuery.onboarding.stepByStepTour.state.patch.mutationOptions().onSuccess,
      consoleQuery.onboarding.stepByStepTour.state.get.queryKey(),
      { step: 1 },
      { step: 2 },
      { body: { step: 2 } },
      { step: 2 },
    ],
    [
      'archive download task after it starts',
      () => consoleQuery.workflowRunArchives.downloads.post.mutationOptions().onSuccess,
      consoleQuery.workflowRunArchives.downloads.byDownloadId.get.queryKey({
        input: { params: { download_id: 'download-1' } },
      }),
      { download_id: 'download-1', status: 'pending' },
      { download_id: 'download-1', status: 'running' },
      {},
      { download_id: 'download-1', status: 'running' },
    ],
    [
      'member list after a removal',
      () => workspace.members.byMemberId.delete.mutationOptions().onSuccess,
      workspace.members.get.queryKey({ input: {} } as never),
      { accounts: [{ id: 'member-1' }, { id: 'member-2' }] },
      undefined,
      { params: { member_id: 'member-1' } },
      { accounts: [{ id: 'member-2' }] },
    ],
    [
      'plugin task list after an install starts',
      () => workspace.plugin.install.marketplace.post.mutationOptions().onSuccess,
      workspace.plugin.tasks.get.queryKey({ input: pluginTaskListInput }),
      { tasks: [{ id: 'task-1' }] },
      { task: { id: 'task-2' } },
      { body: {} },
      { tasks: [{ id: 'task-2' }, { id: 'task-1' }] },
    ],
  ])(
    'the %s is not overwritten by the earlier read',
    async (_name, callback, key, cached, data, variables, written) => {
      const { client, context } = setup()
      client.setQueryData(key, cached)
      const read = createDeferred<unknown>()
      void client.query({ queryKey: key, queryFn: () => read.promise }).catch(() => undefined)

      await (callback() as Callback)(data, variables, undefined, context)
      read.resolve(cached)
      await settle()

      expect(client.getQueryData(key)).toEqual(written)
    },
  )
})
