import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { ORPCError } from '@orpc/client'
import { consoleQuery } from '@/service/console'
import { createTestQueryClient } from '@/test/query-client'

const seed = (queryClient: QueryClient, keys: QueryKey[], data: unknown = {}) => {
  keys.forEach((key) => queryClient.setQueryData(key, data))
}

const isInvalidated = (queryClient: QueryClient, key: QueryKey) =>
  queryClient.getQueryState(key)?.isInvalidated ?? false

const workspace = consoleQuery.workspaces.current

describe('workspace mutation cache policies', () => {
  let queryClient: QueryClient
  const context = () => ({ client: queryClient, meta: undefined })

  beforeEach(() => {
    queryClient = createTestQueryClient()
  })

  it('waits for the education status and declares plan features after a successful application', async () => {
    const featuresKey = consoleQuery.features.get.queryKey()
    const educationKey = consoleQuery.account.education.get.queryKey()
    const variables = { body: { token: 't', role: 'Student', institution: 'School' } } as never
    seed(queryClient, [featuresKey, educationKey])

    await consoleQuery.account.education.post.mutationOptions().onSuccess!(
      { message: 'failed' } as never,
      variables,
      undefined,
      context(),
    )
    expect(isInvalidated(queryClient, educationKey)).toBe(false)

    await consoleQuery.account.education.post.mutationOptions().onSuccess!(
      { message: 'success' } as never,
      variables,
      undefined,
      context(),
    )
    // Plan features refresh through the invalidation fallback.
    expect(isInvalidated(queryClient, featuresKey)).toBe(false)
    expect(isInvalidated(queryClient, educationKey)).toBe(true)
    expect(consoleQuery.account.education.post.mutationOptions().meta?.alsoInvalidate).toEqual([
      'features',
    ])
  })

  it('leaves the profile refresh after a password change to the fallback', () => {
    expect(consoleQuery.account.password.post.mutationOptions().onSuccess).toBeUndefined()
  })

  it.each(['post', 'put'] as const)(
    'refreshes only the written app MCP server on %s',
    async (method) => {
      const serverKey = consoleQuery.apps.byAppId.server.get.queryKey({
        input: { params: { app_id: 'app-1' } },
      })
      const otherServerKey = consoleQuery.apps.byAppId.server.get.queryKey({
        input: { params: { app_id: 'app-2' } },
      })
      seed(queryClient, [serverKey, otherServerKey])

      await consoleQuery.apps.byAppId.server[method].mutationOptions().onSuccess!(
        {} as never,
        { params: { app_id: 'app-1' }, body: {} } as never,
        undefined,
        context(),
      )

      expect(isInvalidated(queryClient, serverKey)).toBe(true)
      expect(isInvalidated(queryClient, otherServerKey)).toBe(false)
    },
  )

  it('refreshes the updated MCP provider tools and the MCP provider list', async () => {
    const toolsKey = workspace.toolProvider.mcp.tools.byProviderId.get.queryKey({
      input: { params: { provider_id: 'mcp-1' } },
    })
    const otherToolsKey = workspace.toolProvider.mcp.tools.byProviderId.get.queryKey({
      input: { params: { provider_id: 'mcp-2' } },
    })
    const mcpListKey = workspace.tools.mcp.get.queryKey()
    seed(queryClient, [toolsKey, otherToolsKey, mcpListKey])

    await workspace.toolProvider.mcp.update.byProviderId.get.mutationOptions().onSuccess!(
      {} as never,
      { params: { provider_id: 'mcp-1' } },
      undefined,
      context(),
    )

    expect(isInvalidated(queryClient, toolsKey)).toBe(true)
    expect(isInvalidated(queryClient, mcpListKey)).toBe(true)
    expect(isInvalidated(queryClient, otherToolsKey)).toBe(false)
  })

  it('waits for the provider list after a provider priority change', async () => {
    const modelsKey = workspace.modelProviders.byProvider.models.get.queryKey({
      input: { params: { provider: 'openai' } },
    })
    const summaryKey = workspace.modelProviders.summary.get.queryKey()
    const providersKey = workspace.modelProviders.get.queryKey()
    seed(queryClient, [modelsKey, summaryKey, providersKey])

    await workspace.modelProviders.byProvider.preferredProviderType.post.mutationOptions()
      .onSuccess!(
      {} as never,
      { params: { provider: 'openai' }, body: { preferred_provider_type: 'system' } } as never,
      undefined,
      context(),
    )

    // Model lists and summaries refresh through the invalidation fallback.
    expect(isInvalidated(queryClient, modelsKey)).toBe(false)
    expect(isInvalidated(queryClient, summaryKey)).toBe(false)
    expect(isInvalidated(queryClient, providersKey)).toBe(true)
    expect(
      workspace.modelProviders.byProvider.preferredProviderType.post.mutationOptions().meta
        ?.alsoInvalidate,
    ).toEqual(['workspaces.current.models.modelTypes'])
  })

  it('waits for the provider list after switching the active credential', async () => {
    const summaryKey = workspace.modelProviders.summary.get.queryKey()
    const providersKey = workspace.modelProviders.get.queryKey()
    seed(queryClient, [summaryKey, providersKey])

    await workspace.modelProviders.byProvider.credentials.switch.post.mutationOptions().onSuccess!(
      {} as never,
      { params: { provider: 'openai' }, body: { credential_id: 'c-1' } },
      undefined,
      context(),
    )

    expect(isInvalidated(queryClient, summaryKey)).toBe(false)
    expect(isInvalidated(queryClient, providersKey)).toBe(true)
    expect(
      workspace.modelProviders.byProvider.credentials.switch.post.mutationOptions().meta
        ?.alsoInvalidate,
    ).toEqual(['workspaces.current.models.modelTypes'])
  })

  it('refreshes the saved default model types only when the save succeeds', async () => {
    const llmKey = workspace.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    })
    const ttsKey = workspace.defaultModel.get.queryKey({
      input: { query: { model_type: 'tts' } },
    })
    seed(queryClient, [llmKey, ttsKey])
    const variables = {
      body: { model_settings: [{ model_type: 'llm', provider: 'openai', model: 'gpt' }] },
    } as never

    await workspace.defaultModel.post.mutationOptions().onSuccess!(
      { result: 'failed' } as never,
      variables,
      undefined,
      context(),
    )
    expect(isInvalidated(queryClient, llmKey)).toBe(false)

    await workspace.defaultModel.post.mutationOptions().onSuccess!(
      { result: 'success' } as never,
      variables,
      undefined,
      context(),
    )
    expect(isInvalidated(queryClient, llmKey)).toBe(true)
    expect(isInvalidated(queryClient, ttsKey)).toBe(false)
  })

  it('adds a created network access group to the group list', async () => {
    const groupsKey = workspace.networkAccessGroups.get.queryKey()
    seed(queryClient, [groupsKey], { entitled: true, groups: [{ id: 'g-1' }] })
    const options = workspace.networkAccessGroups.post.mutationOptions()

    await options.onSuccess!(
      { group: { id: 'g-2' } } as never,
      { body: { name: 'New', description: '', allowed_cidrs: [] } } as never,
      undefined,
      context(),
    )
    await options.onSuccess!(
      { group: { id: 'g-2' } } as never,
      { body: { name: 'New', description: '', allowed_cidrs: [] } } as never,
      undefined,
      context(),
    )

    expect(queryClient.getQueryData(groupsKey)).toEqual({
      entitled: true,
      groups: [{ id: 'g-1' }, { id: 'g-2' }],
    })
  })

  describe('app network access binding', () => {
    const bindingKey = consoleQuery.apps.byAppId.networkAccessGroup.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    })
    const otherBindingKey = consoleQuery.apps.byAppId.networkAccessGroup.get.queryKey({
      input: { params: { app_id: 'app-2' } },
    })
    const groupsKey = workspace.networkAccessGroups.get.queryKey()
    const variables = {
      params: { app_id: 'app-1' },
      body: { enabled: true, group_id: 'g-1', access_points: [], expected_version: 1 },
    } as never

    it('merges the saved binding into the app binding', async () => {
      seed(queryClient, [bindingKey], { entitled: true, binding: null, version: 1 })

      await consoleQuery.apps.byAppId.networkAccessGroup.put.mutationOptions().onSuccess!(
        { binding: { group_id: 'g-1' }, version: 2 } as never,
        variables,
        undefined,
        context(),
      )

      expect(queryClient.getQueryData(bindingKey)).toEqual({
        entitled: true,
        binding: { group_id: 'g-1' },
        version: 2,
      })
    })

    it('reloads the binding and groups after a version conflict', async () => {
      seed(queryClient, [bindingKey, otherBindingKey, groupsKey])
      const options = consoleQuery.apps.byAppId.networkAccessGroup.put.mutationOptions()

      await options.onError!(
        new ORPCError('BAD_REQUEST', { status: 400 }) as never,
        variables,
        undefined,
        context(),
      )
      expect(isInvalidated(queryClient, bindingKey)).toBe(false)

      await options.onError!(
        new ORPCError('network_access_version_conflict', { status: 409, defined: true }) as never,
        variables,
        undefined,
        context(),
      )
      expect(isInvalidated(queryClient, bindingKey)).toBe(true)
      expect(isInvalidated(queryClient, groupsKey)).toBe(true)
      expect(isInvalidated(queryClient, otherBindingKey)).toBe(false)
    })
  })
})
