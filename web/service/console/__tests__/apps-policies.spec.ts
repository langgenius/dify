import type { MutationFunctionContext, QueryKey } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'

type MutationCallback = (...args: unknown[]) => unknown

const clients: QueryClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
  vi.doUnmock('@/utils/client')
})

const setup = async () => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  const { consoleQuery } = await import('@/service/console')
  const client = new QueryClient()
  clients.push(client)
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries')
  const resetQueries = vi.spyOn(client, 'resetQueries')
  const context: MutationFunctionContext = { client, meta: undefined }
  const success = (options: { onSuccess?: unknown }, data: unknown, variables: unknown) =>
    (options.onSuccess as MutationCallback)(data, variables, undefined, context)
  const settled = (options: { onSettled?: unknown }, data: unknown, variables: unknown) =>
    (options.onSettled as MutationCallback)(data, null, variables, undefined, context)
  const invalidatedKeys = () =>
    invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey as QueryKey)
  return {
    client,
    consoleQuery,
    invalidateQueries,
    invalidatedKeys,
    resetQueries,
    settled,
    success,
  }
}

describe('skill mutation policies', () => {
  it('refreshes the skill lists and tags after a create, import, duplicate, or delete', async () => {
    const { consoleQuery, invalidatedKeys, settled, success } = await setup()
    const skills = consoleQuery.workspaces.current.skills
    const listKeys = [
      skills.get.key({ type: 'query' }),
      skills.get.key({ type: 'infinite' }),
      skills.tags.get.key({ type: 'query' }),
    ]
    const params = { skill_id: 'skill-1' }

    await success(skills.post.mutationOptions(), { id: 'skill-2' }, { body: {} })
    await success(skills.import.post.mutationOptions(), { id: 'skill-3' }, { body: {} })
    await success(skills.bySkillId.duplicate.post.mutationOptions(), { id: 'skill-4' }, { params })
    await settled(skills.bySkillId.delete.mutationOptions(), undefined, { params, body: {} })

    expect(invalidatedKeys()).toEqual([...listKeys, ...listKeys, ...listKeys, ...listKeys])
    // Agent skill bindings refresh through the fallback.
    expect(skills.bySkillId.delete.mutationOptions().meta?.alsoInvalidate).toEqual([
      'workspaces.current.agents',
    ])
  })

  it('refreshes the published skill detail, versions, and lists after a publish', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const skills = consoleQuery.workspaces.current.skills

    await success(
      skills.bySkillId.publish.post.mutationOptions(),
      { id: 'version-1' },
      { params: { skill_id: 'skill-1' }, body: {} },
    )

    expect(invalidatedKeys()).toEqual([
      skills.bySkillId.get.queryKey({ input: { params: { skill_id: 'skill-1' } } }),
      skills.bySkillId.versions.get.key({
        type: 'query',
        input: { params: { skill_id: 'skill-1' } },
      }),
      skills.get.key({ type: 'query' }),
      skills.get.key({ type: 'infinite' }),
    ])
  })

  it('waits for one agent skill binding after replacing bindings', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }

    await success(
      consoleQuery.workspaces.current.agents.byAgentId.skills.put.mutationOptions(),
      {},
      { ...input, body: { skill_ids: [] } },
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({ type: 'query', input }),
    ])
    // The agent composer refreshes through the fallback.
    expect(
      consoleQuery.workspaces.current.agents.byAgentId.skills.put.mutationOptions().meta
        ?.alsoInvalidate,
    ).toEqual(['agent'])
  })
})

describe('app mutation policies', () => {
  it('waits for the refreshed triggers, app detail, and custom config', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const params = { app_id: 'app-1' }

    await expect(
      success(consoleQuery.apps.byAppId.triggerEnable.post.mutationOptions(), {}, { params }),
    ).resolves.toBeUndefined()
    await expect(
      success(consoleQuery.apps.byAppId.modelConfig.post.mutationOptions(), {}, { params }),
    ).resolves.toBeDefined()
    await expect(
      success(consoleQuery.workspaces.customConfig.post.mutationOptions(), {}, { body: {} }),
    ).resolves.toBeUndefined()

    expect(invalidatedKeys()).toEqual([
      consoleQuery.apps.byAppId.triggers.get.queryKey({ input: { params } }),
      consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
      consoleQuery.workspaces.customConfig.get.key(),
    ])
  })

  it('writes a rotated MCP server code and refreshes that server exactly', async () => {
    const { client, consoleQuery, invalidateQueries, success } = await setup()
    const params = { app_id: 'app-1' }
    const queryKey = consoleQuery.apps.byAppId.server.get.queryKey({ input: { params } })
    client.setQueryData(queryKey, { id: 'server-1', server_code: 'old', status: 'active' } as never)

    await success(
      consoleQuery.apps.byAppId.server.refresh.post.mutationOptions(),
      { id: 'server-1', server_code: 'new' },
      { params },
    )

    expect(client.getQueryData(queryKey)).toEqual({
      id: 'server-1',
      server_code: 'new',
      status: 'active',
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey, exact: true })
  })

  it('refreshes the published workflow after a version is renamed', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const params = { app_id: 'app-1', workflow_id: 'workflow-1' }

    await success(
      consoleQuery.apps.byAppId.workflows.byWorkflowId.patch.mutationOptions(),
      { id: 'workflow-1' },
      { params, body: {} },
    )

    expect(invalidatedKeys()).toContainEqual(
      consoleQuery.apps.byAppId.workflows.publish.get.queryKey({
        input: { params: { app_id: 'app-1' } },
      }),
    )
  })

  it('writes an environment site and refreshes its subjects after an access mode change', async () => {
    const { client, consoleQuery, invalidatedKeys, success } = await setup()
    const accessService = consoleQuery.enterprise.appDeploy.accessService
    const input = { params: { app_id: 'app-1', environment_id: 'env-1' } }
    const site = { access_mode: 'public', code: 'site-code' }

    await success(accessService.updateEnvironmentWebAppAccessMode.mutationOptions(), site, {
      ...input,
      body: { access_mode: 'public' },
    })

    expect(client.getQueryData(accessService.getEnvironmentSite.queryKey({ input }))).toEqual(site)
    expect(invalidatedKeys()).toEqual([
      accessService.getEnvironmentWebAppSubjects.queryKey({ input }),
    ])

    const resetSite = { ...site, code: 'new-code' }
    await success(accessService.resetEnvironmentSiteAccessToken.mutationOptions(), resetSite, input)
    expect(client.getQueryData(accessService.getEnvironmentSite.queryKey({ input }))).toEqual(
      resetSite,
    )
  })

  it('writes the onboarding tour state a patch returns', async () => {
    const { client, consoleQuery, success } = await setup()
    const state = { completed_task_ids: ['task-1'] }

    await success(consoleQuery.onboarding.stepByStepTour.state.patch.mutationOptions(), state, {
      body: {},
    })

    expect(
      client.getQueryData(consoleQuery.onboarding.stepByStepTour.state.get.queryKey()),
    ).toEqual(state)
  })
})

describe('snippet mutation policies', () => {
  it('marks the snippet published and reloads its version list from the first page', async () => {
    const { client, consoleQuery, resetQueries, success } = await setup()
    const params = { snippet_id: 'snippet-1' }
    const detailKey = consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryKey({
      input: { params },
    })
    client.setQueryData(detailKey, { id: 'snippet-1', is_published: false } as never)

    await success(
      consoleQuery.snippets.bySnippetId.workflows.publish.post.mutationOptions(),
      { created_at: 1 },
      { params, body: {} },
    )

    expect(client.getQueryData(detailKey)).toEqual({ id: 'snippet-1', is_published: true })
    expect(resetQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
        type: 'infinite',
        input: { params },
      }),
    })
  })
})

describe('agent mutation policies', () => {
  it('waits for the published agent detail', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }

    await expect(
      success(
        consoleQuery.agent.byAgentId.publish.post.mutationOptions(),
        { active_config_snapshot_id: 'snapshot-2' },
        { ...input, body: {} },
      ),
    ).resolves.toBeDefined()

    expect(invalidatedKeys()).toContainEqual(consoleQuery.agent.byAgentId.get.queryKey({ input }))
    // Versions and API access are in the agent domain and refresh through the fallback.
    expect(invalidatedKeys()).not.toContainEqual(
      consoleQuery.agent.byAgentId.versions.get.key({ input }),
    )
    expect(invalidatedKeys()).not.toContainEqual(
      consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
    )
  })

  it('waits for the restored agent detail and composer', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }

    await success(
      consoleQuery.agent.byAgentId.versions.byVersionId.restore.post.mutationOptions(),
      {},
      { params: { agent_id: 'agent-1', version_id: 'version-1' } },
    )

    expect(invalidatedKeys()).toHaveLength(2)
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        consoleQuery.agent.byAgentId.get.queryKey({ input }),
        consoleQuery.agent.byAgentId.composer.get.queryKey({ input }),
      ]),
    )
  })

  it('writes the saved or checked-out build draft and refreshes the agent after applying it', async () => {
    const { client, consoleQuery, invalidatedKeys, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }
    const buildDraftKey = consoleQuery.agent.byAgentId.buildDraft.get.queryKey({ input })
    const buildDraft = consoleQuery.agent.byAgentId.buildDraft

    await success(buildDraft.put.mutationOptions(), { id: 'saved' }, { ...input, body: {} })
    expect(client.getQueryData(buildDraftKey)).toEqual({ id: 'saved' })
    await success(buildDraft.checkout.post.mutationOptions(), { id: 'checked-out' }, input)
    expect(client.getQueryData(buildDraftKey)).toEqual({ id: 'checked-out' })

    await success(buildDraft.apply.post.mutationOptions(), {}, input)
    expect(invalidatedKeys()).toEqual([
      consoleQuery.agent.byAgentId.get.queryKey({ input }),
      consoleQuery.agent.get.key(),
    ])
  })

  it('writes the refreshed debug conversation and API access into the agent detail', async () => {
    const { client, consoleQuery, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }
    const detailKey = consoleQuery.agent.byAgentId.get.queryKey({ input })
    client.setQueryData(detailKey, { id: 'agent-1', enable_api: false } as never)

    await success(
      consoleQuery.agent.byAgentId.debugConversation.refresh.post.mutationOptions(),
      { debug_conversation_id: 'conversation-1' },
      input,
    )
    await success(
      consoleQuery.agent.byAgentId.apiEnable.post.mutationOptions(),
      { enabled: true },
      { ...input, body: { enable_api: true } },
    )

    expect(client.getQueryData(detailKey)).toEqual({
      id: 'agent-1',
      enable_api: true,
      debug_conversation_id: 'conversation-1',
      debug_conversation_has_messages: false,
      debug_conversation_message_count: 0,
    })
    expect(
      client.getQueryData(consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input })),
    ).toEqual({ enabled: true })
  })
})

// Keys a policy awaits: its promise settles only once every refresh it started has landed.
const expectAwaitedRefresh = async (
  invalidateQueries: ReturnType<typeof vi.spyOn>,
  run: () => unknown,
) => {
  const pending: Array<() => void> = []
  invalidateQueries.mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)))
  let finished = false
  const result = Promise.resolve(run()).then(() => {
    finished = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(pending.length).toBeGreaterThan(0)
  expect(finished).toBe(false)
  pending.forEach((resolve) => resolve())
  await result
  expect(finished).toBe(true)
}

describe('rating policies', () => {
  it('waits for the completion conversations after rating an app message', async () => {
    const { consoleQuery, invalidateQueries, invalidatedKeys, success } = await setup()
    const options = consoleQuery.apps.byAppId.feedbacks.post.mutationOptions()

    await expectAwaitedRefresh(invalidateQueries, () =>
      success(options, {}, { params: { app_id: 'app-1' }, body: { message_id: 'message-1' } }),
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.apps.byAppId.completionConversations.byConversationId.get.key({
        input: { params: { app_id: 'app-1' } },
      }),
    ])
  })

  it("waits for the agent's logs and log messages after rating an agent message", async () => {
    const { consoleQuery, invalidateQueries, invalidatedKeys, success } = await setup()
    const options = consoleQuery.agent.byAgentId.feedbacks.post.mutationOptions()
    const input = { params: { agent_id: 'agent-1' } }

    await expectAwaitedRefresh(invalidateQueries, () =>
      success(options, {}, { ...input, body: { message_id: 'message-1' } }),
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.agent.byAgentId.logs.get.key({ input }),
      consoleQuery.agent.byAgentId.logs.byConversationId.messages.get.key({ input }),
    ])
  })
})

describe('app site policies and the agents backed by the app', () => {
  const agentKey = (consoleQuery: Awaited<ReturnType<typeof setup>>['consoleQuery'], id: string) =>
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: id } } })
  const seedAgents = ({ client, consoleQuery }: Awaited<ReturnType<typeof setup>>) => {
    const site = { code: 'old-code', access_token: 'old-code', title: 'Site' }
    const backed = { id: 'agent-1', app_id: 'app-1', enable_site: false, site }
    const other = { id: 'agent-2', app_id: 'app-2', enable_site: false, site }
    client.setQueryData(agentKey(consoleQuery, 'agent-1'), backed as never)
    client.setQueryData(agentKey(consoleQuery, 'agent-2'), other as never)
    return { backed, other }
  }

  it('writes the site switch into every agent of the app and leaves other agents untouched', async () => {
    const harness = await setup()
    const { client, consoleQuery, settled } = harness
    const { backed, other } = seedAgents(harness)

    await settled(
      consoleQuery.apps.byAppId.siteEnable.post.mutationOptions(),
      { enable_site: true, updated_at: 2, updated_by: 'user-1' },
      { params: { app_id: 'app-1' }, body: { enable_site: true } },
    )

    expect(client.getQueryData(agentKey(consoleQuery, 'agent-1'))).toEqual({
      ...backed,
      enable_site: true,
      updated_at: 2,
      updated_by: 'user-1',
    })
    expect(client.getQueryData(agentKey(consoleQuery, 'agent-2'))).toBe(other)
  })

  it('writes a reset site code into every agent of the app and leaves other agents untouched', async () => {
    const harness = await setup()
    const { client, consoleQuery, settled } = harness
    const { backed, other } = seedAgents(harness)

    await settled(
      consoleQuery.apps.byAppId.site.accessTokenReset.post.mutationOptions(),
      { code: 'new-code' },
      { params: { app_id: 'app-1' } },
    )

    expect(client.getQueryData(agentKey(consoleQuery, 'agent-1'))).toEqual({
      ...backed,
      site: { ...backed.site, code: 'new-code', access_token: 'new-code' },
    })
    expect(client.getQueryData(agentKey(consoleQuery, 'agent-2'))).toBe(other)
  })
})

describe('web app access policy', () => {
  it('waits for the app detail along with the access data and agent detail', async () => {
    const { consoleQuery, invalidateQueries, invalidatedKeys, success } = await setup()

    await expectAwaitedRefresh(invalidateQueries, () =>
      success(
        consoleQuery.enterprise.webAppAuth.updateWebAppWhitelistSubjects.mutationOptions(),
        { message: 'updated' },
        { body: { appId: 'app-1', accessMode: 'private' } },
      ),
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.key(),
      consoleQuery.enterprise.webAppAuth.getWebAppWhitelistSubjects.key(),
      consoleQuery.apps.byAppId.get.key(),
      consoleQuery.agent.byAgentId.get.key(),
    ])
  })
})

describe('skill publish policy', () => {
  it('writes the published version into the cached detail and waits for that detail', async () => {
    const { client, consoleQuery, invalidateQueries, invalidatedKeys, success } = await setup()
    const skills = consoleQuery.workspaces.current.skills
    const params = { skill_id: 'skill-1' }
    const detailKey = skills.bySkillId.get.queryKey({ input: { params } })
    const detail = { id: 'skill-1', display_name: 'Skill', latest_published_version_number: 1 }
    client.setQueryData(detailKey, detail as never)

    await expectAwaitedRefresh(invalidateQueries, () =>
      success(
        skills.bySkillId.publish.post.mutationOptions(),
        { id: 'version-2', created_at: 20, version_number: 2 },
        { params, body: {} },
      ),
    )

    expect(client.getQueryData(detailKey)).toEqual({
      ...detail,
      latest_published_at: 20,
      latest_published_version_id: 'version-2',
      latest_published_version_number: 2,
    })
    expect(invalidatedKeys()[0]).toEqual(detailKey)
  })
})

describe('MCP provider policies', () => {
  const mcpListKeys = (consoleQuery: Awaited<ReturnType<typeof setup>>['consoleQuery']) => [
    consoleQuery.workspaces.current.toolProviders.get.key(),
    consoleQuery.workspaces.current.tools.mcp.get.key(),
  ]

  it('waits for the MCP catalogs after creating a provider', async () => {
    const { consoleQuery, invalidateQueries, invalidatedKeys, success } = await setup()

    await expectAwaitedRefresh(invalidateQueries, () =>
      success(
        consoleQuery.workspaces.current.toolProvider.mcp.post.mutationOptions(),
        { id: 'provider-1' },
        { body: {} },
      ),
    )

    expect(invalidatedKeys()).toEqual(mcpListKeys(consoleQuery))
  })

  it.each(['put', 'delete'] as const)(
    'waits for the MCP catalogs after a successful %s',
    async (method) => {
      const { consoleQuery, invalidateQueries, invalidatedKeys, success } = await setup()

      await expectAwaitedRefresh(invalidateQueries, () =>
        success(
          consoleQuery.workspaces.current.toolProvider.mcp[method].mutationOptions(),
          { result: 'success' },
          { body: { provider_id: 'provider-1' } },
        ),
      )

      expect(invalidatedKeys()).toEqual(mcpListKeys(consoleQuery))
    },
  )

  it.each(['put', 'delete'] as const)(
    'refreshes nothing after a %s the server refused',
    async (method) => {
      const { consoleQuery, invalidatedKeys, success } = await setup()

      await success(
        consoleQuery.workspaces.current.toolProvider.mcp[method].mutationOptions(),
        { result: 'error' },
        { body: { provider_id: 'provider-1' } },
      )

      expect(invalidatedKeys()).toEqual([])
    },
  )
})

describe('policy writes and reads started before them', () => {
  type ConsoleQuery = Awaited<ReturnType<typeof setup>>['consoleQuery']
  type Case = {
    name: string
    options: (query: ConsoleQuery) => { onSuccess?: unknown }
    key: (query: ConsoleQuery) => QueryKey
    cached: unknown
    data: unknown
    variables: unknown
    written: unknown
    // Another cache entry the policy reads before it writes.
    seed?: (query: ConsoleQuery) => [QueryKey, unknown]
  }
  const appParams = { app_id: 'app-1' }
  const workflow = { id: 'workflow-1', marked_name: 'v1' }
  const renamed = { id: 'workflow-1', marked_name: 'v2' }
  const node = { snippet_id: 'snippet-1', node_id: 'node-1' }
  const site = { params: { app_id: 'app-1', environment_id: 'env-1' } }
  const cases: Case[] = [
    {
      name: 'an app save writes its detail',
      options: (query) => query.apps.byAppId.put.mutationOptions(),
      key: (query) => query.apps.byAppId.get.queryKey({ input: { params: appParams } }),
      cached: { id: 'app-1', name: 'Old' },
      data: { id: 'app-1', name: 'New' },
      variables: { params: appParams, body: { name: 'New' } },
      written: { id: 'app-1', name: 'New' },
    },
    {
      // The deployment detail is the one cache the rename writes but does not refresh.
      name: 'a workflow version rename writes the deployed version',
      options: (query) => query.apps.byAppId.workflows.byWorkflowId.patch.mutationOptions(),
      key: (query) =>
        query.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey({
          input: { params: { ...appParams, environment_id: 'env-1' } },
        }),
      cached: { environment_deployment: { deployment: { current_version: workflow } } },
      data: renamed,
      variables: { params: { ...appParams, workflow_id: 'workflow-1' }, body: {} },
      written: { environment_deployment: { deployment: { current_version: renamed } } },
    },
    {
      // The autosave opts out of the fallback, so only its own cancel protects its write.
      name: 'an agent composer autosave writes the composer',
      options: (query) => query.agent.byAgentId.composer.put.mutationOptions(),
      key: (query) =>
        query.agent.byAgentId.composer.get.queryKey({ input: { params: { agent_id: 'a-1' } } }),
      cached: { draft: 'before' },
      data: { draft: 'autosaved' },
      variables: { params: { agent_id: 'a-1' }, body: { save_strategy: 'draft' } },
      written: { draft: 'autosaved' },
    },
    {
      // The shared helper cancels the list read before adding the created key.
      name: 'an API key create adds the key to its list',
      options: (query) => query.apps.byResourceId.apiKeys.post.mutationOptions(),
      key: (query) =>
        query.apps.byResourceId.apiKeys.get.queryKey({ input: { params: { resource_id: 'r-1' } } }),
      cached: { data: [{ id: 'old' }] },
      data: { id: 'new' },
      variables: { params: { resource_id: 'r-1' } },
      written: { data: [{ id: 'old' }, { id: 'new' }] },
    },
    {
      name: 'an agent save writes its detail',
      options: (query) => query.agent.byAgentId.put.mutationOptions(),
      key: (query) =>
        query.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'a-1' } } }),
      cached: { id: 'a-1', name: 'Old' },
      data: { id: 'a-1', name: 'New' },
      variables: { params: { agent_id: 'a-1' }, body: {} },
      written: { id: 'a-1', name: 'New' },
    },
    {
      // The skill lists are written from the saved skill but refresh only through the fallback.
      name: 'a skill rename writes the skill lists',
      options: (query) => query.workspaces.current.skills.bySkillId.patch.mutationOptions(),
      key: (query) =>
        query.workspaces.current.skills.get.queryKey({
          input: { query: { page: 1, limit: 10, keyword: 'Old' } },
        }),
      seed: (query) => [
        query.workspaces.current.skills.bySkillId.get.queryKey({
          input: { params: { skill_id: 'skill-1' } },
        }),
        { id: 'skill-1', name: 'Old' },
      ],
      cached: { data: [{ id: 'skill-1', name: 'Old' }] },
      data: { id: 'skill-1', name: 'New' },
      variables: { params: { skill_id: 'skill-1' }, body: { name: 'New' } },
      written: { data: [expect.objectContaining({ id: 'skill-1', name: 'New' })] },
    },
    {
      name: 'a snippet agent composer save writes the composer',
      options: (query) =>
        query.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationOptions(),
      key: (query) =>
        query.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
          input: { params: node },
        }),
      cached: { draft: 'old' },
      data: { draft: 'new' },
      variables: { params: node, body: {} },
      written: { draft: 'new' },
    },
    {
      name: 'an environment site token reset writes the site',
      options: (query) =>
        query.enterprise.appDeploy.accessService.resetEnvironmentSiteAccessToken.mutationOptions(),
      key: (query) =>
        query.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({ input: site }),
      cached: { access_token: 'old' },
      data: { access_token: 'new' },
      variables: site,
      written: { access_token: 'new' },
    },
  ]

  it.each(cases)('keeps what $name over a read started before it', async (testCase) => {
    const { client, consoleQuery, success } = await setup()
    const queryKey = testCase.key(consoleQuery)
    if (testCase.seed) client.setQueryData(...testCase.seed(consoleQuery))
    client.setQueryData(queryKey, testCase.cached)
    const staleRead = createDeferred<unknown>()
    const pendingRead = client
      .query({ queryKey, queryFn: () => staleRead.promise, staleTime: 0 })
      .catch(() => undefined)

    await success(testCase.options(consoleQuery), testCase.data, testCase.variables)
    staleRead.resolve(testCase.cached)
    await pendingRead

    expect(client.getQueryData(queryKey)).toEqual(testCase.written)
  })
})
