import type { MutationFunctionContext, QueryKey } from '@tanstack/react-query'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'

const clients: QueryClient[] = []
const setup = () => {
  const client = new QueryClient()
  clients.push(client)
  const invalidated = vi.spyOn(client, 'invalidateQueries')
  const context: MutationFunctionContext = { client, meta: undefined }
  const invalidatedKeys = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey)
  return { client, context, invalidatedKeys }
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

describe('skill metadata policy', () => {
  const skills = consoleQuery.workspaces.current.skills
  const params = { skill_id: 'skill-1' }
  type Detail = Parameters<
    NonNullable<ReturnType<typeof skills.bySkillId.patch.mutationOptions>['onSuccess']>
  >[0]
  const detail = { id: 'skill-1', display_name: 'Renamed', tags: ['a'] } as Detail

  it('writes the returned detail instead of refetching it', async () => {
    const { client, context, invalidatedKeys } = setup()
    const detailKey = skills.bySkillId.get.queryKey({ input: { params } })

    await skills.bySkillId.patch.mutationOptions().onSuccess!(
      detail,
      { params, body: { display_name: 'Renamed', expected_updated_at: 1 } },
      undefined,
      context,
    )

    expect(client.getQueryData(detailKey)).toBe(detail)
    expect(invalidatedKeys()).not.toContainEqual(skills.bySkillId.get.key({ input: { params } }))
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        skills.bySkillId.versions.get.key({ input: { params } }),
        skills.get.key({ type: 'query' }),
      ]),
    )
    expect(invalidatedKeys()).not.toContainEqual(skills.tags.get.key())
  })

  it('refreshes the tag catalog only when tags change', async () => {
    const { context, invalidatedKeys } = setup()

    await skills.bySkillId.patch.mutationOptions().onSuccess!(
      detail,
      { params, body: { tags: ['a'], expected_updated_at: 1 } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).toContainEqual(skills.tags.get.key())
  })
})

describe('member invitation policies', () => {
  it('refreshes seats, members, and the workspace pending invitations after inviting', async () => {
    const { context, invalidatedKeys } = setup()

    await consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions().onSuccess!(
      { result: 'success', tenant_id: 'workspace-1', invitation_results: [] },
      { body: { emails: ['a@example.com'], role: 'normal', language: 'en-US' } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.features.get.queryKey(),
      consoleQuery.workspaces.current.members.get.key(),
      consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
        input: { params: { workspace_id: 'workspace-1' } },
      }),
    ])
  })

  it('refreshes the same caches after a revoke, even a failed one', async () => {
    const { context, invalidatedKeys } = setup()
    const revoke = consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.revoke.post

    await revoke.mutationOptions().onSettled!(
      undefined,
      new Error('gone'),
      { params: { workspace_id: 'workspace-1' }, body: { email: 'a@example.com' } } as Parameters<
        NonNullable<ReturnType<typeof revoke.mutationOptions>['onSettled']>
      >[2],
      undefined,
      context,
    )

    expect(invalidatedKeys()).toHaveLength(3)
    expect(invalidatedKeys()).toContainEqual(
      consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
        input: { params: { workspace_id: 'workspace-1' } },
      }),
    )
  })
})

describe('workflow publish policies', () => {
  const workflows = consoleQuery.apps.byAppId.workflows
  const params = { app_id: 'app-1' }
  const defaultMetricsKey =
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.defaultMetrics.get.key({
      type: 'query',
      input: { params: { evaluate_target_id: 'app-1', evaluate_target_type: 'apps' } },
    })

  it('refreshes evaluation metrics after a standard publish', async () => {
    const { context, invalidatedKeys } = setup()
    const publish = workflows.publish.post.mutationOptions()

    await publish.onSuccess!(
      {} as Parameters<NonNullable<typeof publish.onSuccess>>[0],
      { params, body: {} } as Parameters<NonNullable<typeof publish.onSuccess>>[1],
      undefined,
      context,
    )

    expect(invalidatedKeys()).toContainEqual(defaultMetricsKey)
  })

  it('refreshes the app, its workflow, and evaluation lists after an evaluation publish', async () => {
    const { context, invalidatedKeys } = setup()
    const publish = workflows.publish.evaluation.post.mutationOptions()

    await publish.onSuccess!(
      {} as Parameters<NonNullable<typeof publish.onSuccess>>[0],
      { params, body: {} } as Parameters<NonNullable<typeof publish.onSuccess>>[1],
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        workflows.publish.get.key({ input: { params } }),
        consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
        consoleQuery.apps.byAppId.triggers.get.key({ input: { params } }),
        consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
        defaultMetricsKey,
      ]),
    )
  })

  it('awaits the refresh after converting the workflow kind', async () => {
    const { context, invalidatedKeys } = setup()
    const convert = workflows.convertType.post.mutationOptions()

    await convert.onSuccess!(
      {} as Parameters<NonNullable<typeof convert.onSuccess>>[0],
      { params, query: { target_type: 'evaluation' } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual([
      workflows.publish.get.key({ input: { params } }),
      consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
      consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
    ])
  })
})

describe('mutations and the refetches they start', () => {
  type Callback = (...args: unknown[]) => unknown
  const workspace = consoleQuery.workspaces.current
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const unsubscribers: Array<() => void> = []

  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  })

  /** Mounts a loaded query whose next response resolves only when the test says so. */
  async function mountLoaded(client: QueryClient, queryKey: QueryKey) {
    const refetch = createDeferred<unknown>()
    const queryFn = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ loaded: true })
      .mockReturnValue(refetch.promise)
    const observer = new QueryObserver(client, { queryKey, queryFn })
    unsubscribers.push(observer.subscribe(() => undefined))
    await settle()
    return { queryFn, refetch }
  }

  /** Runs a policy callback and reports whether the promise it returned has settled. */
  function track(result: unknown) {
    const state = { done: false }
    void Promise.resolve(result).then(() => {
      state.done = true
    })
    return state
  }

  const provider = { provider: 'provider-1' }
  it.each<[string, QueryKey, () => Callback, unknown[]]>([
    [
      'builtin tool credential add',
      workspace.toolProvider.builtin.byProvider.credential.info.get.key({
        input: { params: provider },
      }),
      () =>
        workspace.toolProvider.builtin.byProvider.add.post.mutationOptions().onSuccess as Callback,
      [{}, { params: provider }, undefined],
    ],
    [
      'builtin tool OAuth client save',
      workspace.toolProvider.builtin.byProvider.oauth.customClient.get.key({
        input: { params: provider },
      }),
      () =>
        workspace.toolProvider.builtin.byProvider.oauth.customClient.post.mutationOptions()
          .onSuccess as Callback,
      [{}, { params: provider }, undefined],
    ],
    [
      'endpoint delete',
      workspace.endpoints.list.key(),
      () => workspace.endpoints.byId.delete.mutationOptions().onSettled as Callback,
      [{}, null, { params: { id: 'endpoint-1' } }, undefined],
    ],
    [
      'network access group update',
      workspace.networkAccessGroups.get.key(),
      () => workspace.networkAccessGroups.byGroupId.put.mutationOptions().onSettled as Callback,
      [{}, null, { params: { group_id: 'group-1' } }, undefined],
    ],
    [
      'role creation',
      workspace.rbac.roles.get.key(),
      () => workspace.rbac.roles.post.mutationOptions().onSettled as Callback,
      [{}, null, { body: {} }, undefined],
    ],
    [
      'external contact creation',
      workspace.humanInput.v2.contacts.key(),
      () => workspace.humanInput.v2.contacts.external.post.mutationOptions().onSuccess as Callback,
      [{}, { body: {} }, undefined],
    ],
    [
      'IM channel update',
      workspace.humanInput.v2.channels.get.key(),
      () =>
        workspace.humanInput.v2.channels.im.byChannelId.put.mutationOptions().onSettled as Callback,
      [{}, null, { params: { channel_id: 'channel-1' } }, undefined],
    ],
  ])('%s starts the refetch without waiting for it', async (_, queryKey, policy, args) => {
    const { client, context } = setup()
    const { queryFn, refetch } = await mountLoaded(client, queryKey)

    const result = policy()(...args, context)
    await settle()

    expect(result).toBeUndefined()
    expect(queryFn).toHaveBeenCalledTimes(2)
    refetch.resolve({ loaded: true })
  })

  it('waits for the endpoint list, not plugin counts, after toggling an endpoint', async () => {
    const { client, context } = setup()
    const list = await mountLoaded(client, workspace.endpoints.list.key())
    const plugins = await mountLoaded(client, workspace.plugin.list.get.key())
    const { onSettled } = workspace.endpoints.enable.post.mutationOptions()

    const state = track(
      (onSettled as Callback)(
        {},
        null,
        { body: { endpoint_id: 'endpoint-1' } },
        undefined,
        context,
      ),
    )
    await settle()
    expect(plugins.queryFn).toHaveBeenCalledTimes(2)
    expect(state.done).toBe(false)

    list.refetch.resolve({ loaded: true })
    await settle()
    expect(state.done).toBe(true)
    plugins.refetch.resolve({ loaded: true })
  })

  it('waits for the agent access settings, not agent lists, after changing the scope', async () => {
    const { client, context } = setup()
    const params = { agent_id: 'agent-1' }
    const settings = await mountLoaded(
      client,
      workspace.rbac.agents.byAgentId.key({ input: { params } }),
    )
    const agents = await mountLoaded(client, consoleQuery.agent.get.key())
    const { onSettled } = workspace.rbac.agents.byAgentId.whitelist.put.mutationOptions()

    const state = track(
      (onSettled as Callback)(
        {},
        null,
        { params, body: { automatic_include_workspace_members: true } },
        undefined,
        context,
      ),
    )
    await settle()
    expect(agents.queryFn).toHaveBeenCalledTimes(2)
    expect(state.done).toBe(false)

    settings.refetch.resolve({ loaded: true })
    await settle()
    expect(state.done).toBe(true)
    agents.refetch.resolve({ loaded: true })
  })
})
