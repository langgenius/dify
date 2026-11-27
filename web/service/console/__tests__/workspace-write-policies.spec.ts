import type {
  MutationFunctionContext,
  MutationObserverOptions,
  QueryKey,
} from '@tanstack/react-query'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
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

  it('keeps the cached files and refetches the detail after a metadata save', async () => {
    const { client, context, invalidatedKeys } = setup()
    const detailKey = skills.bySkillId.get.queryKey({ input: { params } })
    const files = [{ path: 'SKILL.md' }]
    client.setQueryData(detailKey, { ...detail, display_name: 'Before', files } as never)

    await skills.bySkillId.patch.mutationOptions().onSuccess!(
      detail,
      { params, body: { display_name: 'Renamed', expected_updated_at: 1 } },
      undefined,
      context,
    )

    // The PATCH response has no files: the file tree must not be cleared.
    expect(client.getQueryData(detailKey)).toMatchObject({ display_name: 'Renamed', files })
    // Versions and skill lists refresh through the fallback; agents list the skills bound to them.
    expect(invalidatedKeys()).toEqual([detailKey])
    expect(skills.bySkillId.patch.mutationOptions().meta?.alsoInvalidate).toEqual([
      'workspaces.current.agents',
    ])
  })

  it('shows the refetched detail, not an older response that lands afterwards', async () => {
    const { client, context } = setup()
    const detailKey = skills.bySkillId.get.queryKey({ input: { params } })
    const stale = createDeferred<Detail>()
    const fresh = { ...detail, files: [{ path: 'SKILL.md' }] } as Detail
    client.setQueryData(detailKey, { ...detail, display_name: 'Before' })
    const queryFn = vi.fn(() => (queryFn.mock.calls.length === 1 ? stale.promise : fresh))
    const observer = new QueryObserver(client, { queryKey: detailKey, queryFn })
    const unsubscribe = observer.subscribe(() => undefined)
    void client.refetchQueries({ queryKey: detailKey })

    await skills.bySkillId.patch.mutationOptions().onSuccess!(
      detail,
      { params, body: { display_name: 'Renamed', expected_updated_at: 1 } },
      undefined,
      context,
    )
    stale.resolve({ ...detail, display_name: 'Before' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    unsubscribe()

    expect(client.getQueryData(detailKey)).toEqual(fresh)
  })

  it('leaves the tag catalog to the fallback when tags change', async () => {
    const { context, invalidatedKeys } = setup()

    await skills.bySkillId.patch.mutationOptions().onSuccess!(
      detail,
      { params, body: { tags: ['a'], expected_updated_at: 1 } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).not.toContainEqual(skills.tags.get.key())
  })
})

describe('member invitation policies', () => {
  it('leaves seats, members, and pending invitations to the fallback after inviting', () => {
    const options = consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions()

    expect(options.onSuccess).toBeUndefined()
    expect(options.meta?.alsoInvalidate).toEqual([
      'features',
      'workspaces.byWorkspaceId.members.pendingInvitations',
    ])
  })

  it('waits only for the pending invitations after a successful revoke', async () => {
    const { context, invalidatedKeys } = setup()
    const revoke = consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.revoke.post
    const variables = {
      params: { workspace_id: 'workspace-1' },
      body: { email: 'a@example.com' },
    } as Parameters<NonNullable<ReturnType<typeof revoke.mutationOptions>['onSettled']>>[2]

    await revoke.mutationOptions().onSettled!(undefined, null, variables, undefined, context)

    expect(invalidatedKeys()).toEqual([
      consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
        input: { params: { workspace_id: 'workspace-1' } },
      }),
    ])
    expect(revoke.mutationOptions().meta?.alsoInvalidate).toEqual([
      'features',
      'workspaces.current.members',
    ])
  })

  it('refreshes members and seats too after a failed revoke', async () => {
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
  // Evaluation metrics and pickers, roster agents, and deployments read the published workflow.
  const publishedWorkflowReaders = [
    'byEvaluateTargetType',
    'workspaces.current.availableEvaluationWorkflows',
    'agent',
    'enterprise.appDeploy',
  ]

  it('waits for the published workflow and declares its readers after a standard publish', async () => {
    const { context, invalidatedKeys } = setup()
    const publish = workflows.publish.post.mutationOptions()

    await publish.onSuccess!(
      {} as Parameters<NonNullable<typeof publish.onSuccess>>[0],
      { params, body: {} } as Parameters<NonNullable<typeof publish.onSuccess>>[1],
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual([workflows.publish.get.key({ input: { params } })])
    expect(publish.meta?.alsoInvalidate).toEqual(publishedWorkflowReaders)
  })

  it('waits for the published workflow and declares its readers after an evaluation publish', async () => {
    const { context, invalidatedKeys } = setup()
    const publish = workflows.publish.evaluation.post.mutationOptions()

    await publish.onSuccess!(
      {} as Parameters<NonNullable<typeof publish.onSuccess>>[0],
      { params, body: {} } as Parameters<NonNullable<typeof publish.onSuccess>>[1],
      undefined,
      context,
    )

    // The app detail and triggers are in the apps domain and refresh through the fallback.
    expect(invalidatedKeys()).toEqual([workflows.publish.get.key({ input: { params } })])
    expect(publish.meta?.alsoInvalidate).toEqual(publishedWorkflowReaders)
  })

  it('awaits the app detail refresh after converting the workflow kind', async () => {
    const { context, invalidatedKeys } = setup()
    const convert = workflows.convertType.post.mutationOptions()

    await convert.onSuccess!(
      {} as Parameters<NonNullable<typeof convert.onSuccess>>[0],
      { params, query: { target_type: 'evaluation' } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
    ])
    expect(convert.meta?.alsoInvalidate).toEqual([
      'workspaces.current.availableEvaluationWorkflows',
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
  ])('%s waits for the refetch of the data it changes', async (_, queryKey, policy, args) => {
    const { client, context } = setup()
    const { queryFn, refetch } = await mountLoaded(client, queryKey)

    const state = track(policy()(...args, context))
    await settle()

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(state.done).toBe(false)
    refetch.resolve({ loaded: true })
    await settle()
    expect(state.done).toBe(true)
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
    // Plugin counts refresh through the invalidation fallback after a success.
    expect(plugins.queryFn).toHaveBeenCalledTimes(1)
    expect(state.done).toBe(false)

    list.refetch.resolve({ loaded: true })
    await settle()
    expect(state.done).toBe(true)
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
    // Agent lists refresh through the invalidation fallback.
    expect(agents.queryFn).toHaveBeenCalledTimes(1)
    expect(state.done).toBe(false)

    settings.refetch.resolve({ loaded: true })
    await settle()
    expect(state.done).toBe(true)
  })
})

describe('evaluation config save policies', () => {
  it.each([
    [
      'app',
      () => consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation,
      { evaluate_target_type: 'apps', evaluate_target_id: 'app-1' },
    ],
    ['dataset', () => consoleQuery.datasets.byDatasetId.evaluation, { dataset_id: 'dataset-1' }],
  ] as const)(
    'keeps the %s config save pending until the reloaded config lands',
    async (_, evaluation, params) => {
      const { client } = setup()
      const configKey = evaluation().get.queryKey({ input: { params } } as never)
      const reload = createDeferred<unknown>()
      const queryFn = vi.fn(() => (queryFn.mock.calls.length === 1 ? {} : reload.promise))
      const observer = new QueryObserver(client, { queryKey: configKey, queryFn })
      const unsubscribe = observer.subscribe(() => undefined)
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

      let saved = false
      const options = evaluation().put.mutationOptions({
        mutationFn: async () => ({}) as never,
      } as never) as MutationObserverOptions<unknown, Error, unknown, unknown>
      const save = new MutationObserver(client, options)
        .mutate({ params, body: {} } as never)
        .then(() => {
          saved = true
        })
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(saved).toBe(false)

      reload.resolve({})
      await save
      unsubscribe()
      expect(saved).toBe(true)
    },
  )
})

describe('saves whose editor reopens from the refreshed data', () => {
  const workspace = () => consoleQuery.workspaces.current
  const rbac = () => workspace().rbac
  type Case = [string, () => unknown, QueryKey, unknown]
  const memberParams = { member_id: 'member-1' }
  it.each<Case>([
    ['role create', () => rbac().roles.post.mutationOptions, rbac().roles.get.key(), { body: {} }],
    [
      'role edit',
      () => rbac().roles.byRoleId.put.mutationOptions,
      rbac().roles.get.key(),
      { params: { role_id: 'r' } },
    ],
    [
      'permission-set create',
      () => rbac().accessPolicies.post.mutationOptions,
      rbac().key(),
      { body: {} },
    ],
    [
      'permission-set edit',
      () => rbac().accessPolicies.byPolicyId.put.mutationOptions,
      rbac().key(),
      { params: { policy_id: 'p' } },
    ],
    [
      'member role assignment (member list)',
      () => rbac().members.byMemberId.rbacRoles.put.mutationOptions,
      workspace().members.get.key(),
      { params: memberParams, body: {} },
    ],
    [
      'member role assignment (member roles)',
      () => rbac().members.byMemberId.rbacRoles.put.mutationOptions,
      rbac().members.byMemberId.rbacRoles.get.key({ input: { params: memberParams } }),
      { params: memberParams, body: {} },
    ],
    [
      'file scanner create',
      () => consoleQuery.fileScan.providers.post.mutationOptions,
      consoleQuery.fileScan.providers.get.key(),
      { body: {} },
    ],
    [
      'file scanner edit',
      () => consoleQuery.fileScan.providers.byProviderId.patch.mutationOptions,
      consoleQuery.fileScan.providers.get.key(),
      { params: { provider_id: 'scanner-1' }, body: {} },
    ],
    [
      'built-in tool credential edit',
      () => workspace().toolProvider.builtin.byProvider.update.post.mutationOptions,
      workspace().toolProvider.builtin.byProvider.credential.info.get.key({
        input: { params: { provider: 'tool-1' } },
      }),
      { params: { provider: 'tool-1' }, body: {} },
    ],
    [
      'data source credential edit',
      () => consoleQuery.auth.plugin.datasource.byProviderId.update.post.mutationOptions,
      consoleQuery.auth.plugin.datasource.list.get.key(),
      { params: { provider_id: 'source-1' }, body: {} },
    ],
    [
      'external contact edit',
      () => workspace().humanInput.v2.contacts.external.byContactId.patch.mutationOptions,
      workspace().humanInput.v2.contacts.key(),
      { params: { contact_id: 'contact-1' }, body: {} },
    ],
    [
      'web app access save',
      () => consoleQuery.enterprise.webAppAuth.updateWebAppWhitelistSubjects.mutationOptions,
      consoleQuery.agent.byAgentId.get.key(),
      { body: {} },
    ],
    [
      'batch document metadata edit',
      () => consoleQuery.datasets.byDatasetId.documents.metadata.post.mutationOptions,
      consoleQuery.datasets.byDatasetId.documents.get.key({
        input: { params: { dataset_id: 'dataset-1' } },
      }),
      { params: { dataset_id: 'dataset-1' }, body: {} },
    ],
    [
      'metadata field rename',
      () => consoleQuery.datasets.byDatasetId.metadata.byMetadataId.patch.mutationOptions,
      consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
        input: { params: { dataset_id: 'dataset-1' } },
      }),
      { params: { dataset_id: 'dataset-1', metadata_id: 'field-1' }, body: {} },
    ],
    [
      'pipeline version edit',
      () => consoleQuery.rag.pipelines.byPipelineId.workflows.byWorkflowId.patch.mutationOptions,
      consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
        input: { params: { pipeline_id: 'pipeline-1' } },
      }),
      { params: { pipeline_id: 'pipeline-1', workflow_id: 'version-1' }, body: {} },
    ],
    [
      'snippet version edit',
      () => consoleQuery.snippets.bySnippetId.workflows.byWorkflowId.patch.mutationOptions,
      consoleQuery.snippets.bySnippetId.workflows.get.key({
        input: { params: { snippet_id: 'snippet-1' } },
      }),
      { params: { snippet_id: 'snippet-1', workflow_id: 'version-1' }, body: {} },
    ],
    [
      'workflow publish (deploy latest reads the published version)',
      () => consoleQuery.apps.byAppId.workflows.publish.post.mutationOptions,
      consoleQuery.apps.byAppId.workflows.publish.get.key({
        input: { params: { app_id: 'app-1' } },
      }),
      { params: { app_id: 'app-1' }, body: {} },
    ],
    [
      'evaluation workflow publish (deploy latest reads the published version)',
      () => consoleQuery.apps.byAppId.workflows.publish.evaluation.post.mutationOptions,
      consoleQuery.apps.byAppId.workflows.publish.get.key({
        input: { params: { app_id: 'app-1' } },
      }),
      { params: { app_id: 'app-1' }, body: {} },
    ],
    [
      'metadata field delete (the batch editor reads the document list)',
      () => consoleQuery.datasets.byDatasetId.metadata.byMetadataId.delete.mutationOptions,
      consoleQuery.datasets.byDatasetId.documents.get.key({
        input: { params: { dataset_id: 'dataset-1' } },
      }),
      { params: { dataset_id: 'dataset-1', metadata_id: 'field-1' } },
    ],
    ...(['dataset', 'target'] as const).flatMap((owner): Case[] => {
      const evaluation =
        owner === 'dataset'
          ? consoleQuery.datasets.byDatasetId.evaluation
          : consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation
      const target =
        owner === 'dataset'
          ? { dataset_id: 'dataset-1' }
          : { evaluate_target_type: 'apps', evaluate_target_id: 'app-1' }
      const logsKey = evaluation.logs.get.queryKey({ input: { params: target } } as never)
      const params = { ...target, run_id: 'run-1' }
      return [
        [
          `${owner} evaluation run cancel`,
          () => evaluation.runs.byRunId.cancel.post.mutationOptions,
          logsKey,
          { params },
        ],
        [
          `${owner} evaluation run retry`,
          () => evaluation.runs.byRunId.retry.post.mutationOptions,
          logsKey,
          { params },
        ],
      ]
    }),
    [
      'IP policy update (the edit session reopens with the group version)',
      () => workspace().networkAccessGroups.byGroupId.put.mutationOptions,
      workspace().networkAccessGroups.get.key(),
      { params: { group_id: 'group-1' }, body: {} },
    ],
    ...(['apps', 'agent'] as const).flatMap((owner): Case[] => {
      const trace =
        owner === 'apps'
          ? consoleQuery.apps.byAppId.traceConfig
          : consoleQuery.agent.byAgentId.traceConfig
      const params = owner === 'apps' ? { app_id: 'app-1' } : { agent_id: 'agent-1' }
      const configKey = trace.get.queryKey({
        input: { params, query: { tracing_provider: 'langfuse' } },
      } as never)
      const body = { tracing_provider: 'langfuse', tracing_config: {} }
      return [
        [
          `${owner} tracing config create`,
          () => trace.post.mutationOptions,
          configKey,
          { params, body },
        ],
        [
          `${owner} tracing config edit`,
          () => trace.patch.mutationOptions,
          configKey,
          { params, body },
        ],
        [
          `${owner} tracing config removal`,
          () => trace.delete.mutationOptions,
          configKey,
          { params, query: { tracing_provider: 'langfuse' } },
        ],
      ]
    }),
  ])(
    'keeps a %s pending until the data that seeds its editor reloads',
    async (_, mutationOptions, listKey, variables) => {
      const { client } = setup()
      const queryKey = [...listKey, 'seeded-editor']
      const reload = createDeferred<unknown>()
      const queryFn = vi.fn(() => (queryFn.mock.calls.length === 1 ? {} : reload.promise))
      const observer = new QueryObserver(client, { queryKey, queryFn })
      const unsubscribe = observer.subscribe(() => undefined)
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

      let saved = false
      const options = (mutationOptions() as (options: unknown) => unknown)({
        mutationFn: async () => ({}),
      }) as MutationObserverOptions<unknown, Error, unknown, unknown>
      const save = new MutationObserver(client, options).mutate(variables).then(() => {
        saved = true
      })
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(saved).toBe(false)

      reload.resolve({})
      await save
      unsubscribe()
      expect(saved).toBe(true)
    },
  )
})

describe('creates that reveal a one-time secret', () => {
  type Case = [string, () => unknown, QueryKey, unknown, Record<string, unknown>]
  const appParams = { resource_id: 'app-1' }
  const envParams = { app_id: 'app-1', environment_id: 'env-1' }
  const access = () => consoleQuery.enterprise.appDeploy.accessService
  it.each<Case>([
    [
      'personal access token',
      () => consoleQuery.account.personalAccessTokens.post.mutationOptions,
      consoleQuery.account.personalAccessTokens.get.queryKey({
        input: { query: { page: 1 } },
      } as never),
      { body: { name: 'New token' } },
      { id: 'token-2', name: 'New token', secret: 'dpat_secret' },
    ],
    [
      'app API key',
      () => consoleQuery.apps.byResourceId.apiKeys.post.mutationOptions,
      consoleQuery.apps.byResourceId.apiKeys.get.queryKey({ input: { params: appParams } }),
      { params: appParams },
      { id: 'key-2', token: 'app-secret' },
    ],
    [
      'agent API key',
      () => consoleQuery.agent.byAgentId.apiKeys.post.mutationOptions,
      consoleQuery.agent.byAgentId.apiKeys.get.queryKey({
        input: { params: { agent_id: 'agent-1' } },
      }),
      { params: { agent_id: 'agent-1' } },
      { id: 'key-2', token: 'agent-secret' },
    ],
    [
      'dataset API key',
      () => consoleQuery.datasets.apiKeys.post.mutationOptions,
      consoleQuery.datasets.apiKeys.get.queryKey({} as never),
      {},
      { id: 'key-2', token: 'dataset-secret' },
    ],
    [
      'environment API key',
      () => access().createEnvironmentApiKey.mutationOptions,
      access().listEnvironmentApiKeys.queryKey({ input: { params: envParams } } as never),
      { params: envParams },
      { id: 'key-2', token: 'env-secret' },
    ],
  ])(
    'a %s create resolves with the new entry in the list before its refetch lands',
    async (name, mutationOptions, listKey, variables, created) => {
      const { client } = setup()
      const isToken = name === 'personal access token'
      const loaded = isToken
        ? { data: [{ id: 'token-1' }], page: 1, limit: 20, total: 1, has_more: false }
        : { data: [{ id: 'key-1' }] }
      const reload = createDeferred<unknown>()
      const queryFn = vi.fn(() => (queryFn.mock.calls.length === 1 ? loaded : reload.promise))
      const observer = new QueryObserver(client, { queryKey: listKey, queryFn })
      const unsubscribe = observer.subscribe(() => undefined)
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

      const options = (mutationOptions() as (options: unknown) => unknown)({
        mutationFn: async () => created,
      }) as MutationObserverOptions<unknown, Error, unknown, unknown>
      await new MutationObserver(client, options).mutate(variables)

      // The refetch is still pending, but the list already has the new entry.
      expect(queryFn).toHaveBeenCalledTimes(2)
      const ids = (client.getQueryData(listKey) as { data: Array<{ id: string; secret?: string }> })
        .data
      expect(ids.map((row) => row.id)).toContain(created.id)
      if (isToken) expect(ids.find((row) => row.id === created.id)).not.toHaveProperty('secret')
      reload.resolve(loaded)
      unsubscribe()
    },
  )
})
