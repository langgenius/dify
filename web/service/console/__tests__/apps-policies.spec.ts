import type { MutationFunctionContext, QueryKey } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

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

    expect(invalidatedKeys()).toEqual([
      ...listKeys,
      ...listKeys,
      ...listKeys,
      ...listKeys,
      consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
    ])
  })

  it('refreshes the published skill versions and lists after a publish', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const skills = consoleQuery.workspaces.current.skills

    await success(
      skills.bySkillId.publish.post.mutationOptions(),
      { id: 'version-1' },
      { params: { skill_id: 'skill-1' }, body: {} },
    )

    expect(invalidatedKeys()).toEqual([
      skills.bySkillId.versions.get.key({
        type: 'query',
        input: { params: { skill_id: 'skill-1' } },
      }),
      skills.get.key({ type: 'query' }),
      skills.get.key({ type: 'infinite' }),
    ])
  })

  it('refreshes one agent skill binding and its composer after replacing bindings', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }

    await success(
      consoleQuery.workspaces.current.agents.byAgentId.skills.put.mutationOptions(),
      {},
      { ...input, body: { skill_ids: [] } },
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({ type: 'query', input }),
      consoleQuery.agent.byAgentId.composer.get.key({ type: 'query', input }),
    ])
  })
})

describe('app mutation policies', () => {
  it('waits for the refreshed triggers and custom config, and refreshes the app detail in the background', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const params = { app_id: 'app-1' }

    await expect(
      success(consoleQuery.apps.byAppId.triggerEnable.post.mutationOptions(), {}, { params }),
    ).resolves.toBeUndefined()
    expect(
      success(consoleQuery.apps.byAppId.modelConfig.post.mutationOptions(), {}, { params }),
    ).toBeUndefined()
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
  it('refreshes the published agent versions and API access, and waits for its detail', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }

    await expect(
      success(
        consoleQuery.agent.byAgentId.publish.post.mutationOptions(),
        { active_config_snapshot_id: 'snapshot-2' },
        { ...input, body: {} },
      ),
    ).resolves.toBeDefined()

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        consoleQuery.agent.byAgentId.versions.get.key({ input }),
        consoleQuery.agent.byAgentId.get.queryKey({ input }),
        consoleQuery.agent.byAgentId.apiAccess.get.queryKey({ input }),
      ]),
    )
  })

  it('refreshes the restored agent detail, composer, and versions', async () => {
    const { consoleQuery, invalidatedKeys, success } = await setup()
    const input = { params: { agent_id: 'agent-1' } }

    await success(
      consoleQuery.agent.byAgentId.versions.byVersionId.restore.post.mutationOptions(),
      {},
      { params: { agent_id: 'agent-1', version_id: 'version-1' } },
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.agent.byAgentId.get.queryKey({ input }),
      consoleQuery.agent.byAgentId.composer.get.queryKey({ input }),
      consoleQuery.agent.byAgentId.versions.get.key({ input }),
    ])
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
