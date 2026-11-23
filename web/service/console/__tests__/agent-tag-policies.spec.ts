import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import { MutationObserver, QueryObserver } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
// boundary: supply the Console API response while the generated mutation executes its cache policy.
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call } }))

it.each(['rename', 'delete'] as const)(
  'syncs Agent tags, roster, detail and Workflow options after %s',
  async (operation) => {
    const client = createTestQueryClient()
    const agentTag = { id: 'agent-tag', name: 'Research', type: 'agent' }
    const appTag = { id: 'app-tag', name: 'Research', type: 'app' }
    const agentCatalog = consoleQuery.tags.get.queryKey({ input: { query: { type: 'agent' } } })
    const appCatalog = consoleQuery.tags.get.queryKey({ input: { query: { type: 'app' } } })
    const financeSearch = consoleQuery.tags.get.queryKey({
      input: { query: { type: 'agent', keyword: 'Finance' } },
    })
    const agentResults = [
      consoleQuery.agent.get.key({
        type: 'infinite',
        input: { query: { tag_ids: [agentTag.id] } },
      }),
      consoleQuery.agent.inviteOptions.get.key({
        type: 'infinite',
        input: { query: { tag_ids: [agentTag.id] } },
      }),
      consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'agent-1' } } }),
      consoleQuery.externalAgents.get.key({
        type: 'infinite',
        input: { query: { tag_ids: [agentTag.id] } },
      }),
      consoleQuery.externalAgents.byAgentId.get.queryKey({
        input: { params: { agent_id: 'agent-1' } },
      }),
    ]
    const appResults = consoleQuery.apps.get.key({ type: 'infinite' })
    for (const key of [...agentResults, appResults]) client.setQueryData(key, {})
    client.setQueryData(agentCatalog, [agentTag])
    client.setQueryData(appCatalog, [appTag])
    client.setQueryData(financeSearch, [])
    await client.invalidateQueries({ queryKey: appCatalog })

    const staleRead = createDeferred<TagResponse[]>()
    call.mockReturnValueOnce(staleRead.promise)
    const pendingRead = client.query(
      consoleQuery.tags.get.queryOptions({ input: { query: { type: 'agent' } }, staleTime: 0 }),
    )
    const params = { tag_id: agentTag.id }
    const updatedTag = { ...agentTag, name: 'Finance' }
    if (operation === 'rename') {
      call.mockResolvedValueOnce(updatedTag)
      await new MutationObserver(client, consoleQuery.tags.byTagId.patch.mutationOptions()).mutate({
        params,
        body: { name: updatedTag.name },
      })
      expect(client.getQueryState(financeSearch)?.isInvalidated).toBe(true)
    } else {
      call.mockResolvedValueOnce(undefined)
      await new MutationObserver(client, consoleQuery.tags.byTagId.delete.mutationOptions()).mutate(
        { params },
      )
    }

    staleRead.resolve([agentTag])
    await pendingRead
    expect(client.getQueryData(agentCatalog)).toEqual(operation === 'rename' ? [updatedTag] : [])
    for (const key of agentResults) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryData(appCatalog)).toEqual([appTag])
    expect(client.getQueryState(appCatalog)?.isInvalidated).toBe(true)
    expect(client.getQueryState(appResults)?.isInvalidated).toBe(false)
  },
)

it('includes a newly created Agent tag when the first catalog read is still pending', async () => {
  const client = createTestQueryClient()
  const createdTag = { id: 'research', name: 'Research', type: 'agent' as const }
  const existingTag = { id: 'finance', name: 'Finance', type: 'agent' }
  const staleRead = createDeferred<TagResponse[]>()
  call.mockReturnValueOnce(staleRead.promise)
  const observer = new QueryObserver(
    client,
    consoleQuery.tags.get.queryOptions({ input: { query: { type: 'agent' } } }),
  )
  onTestFinished(observer.subscribe(() => {}))
  const pendingRead = observer.refetch()

  call.mockResolvedValueOnce(createdTag).mockResolvedValueOnce([createdTag, existingTag])
  await new MutationObserver(client, consoleQuery.tags.post.mutationOptions()).mutate({
    body: { name: createdTag.name, type: createdTag.type },
  })
  staleRead.resolve([existingTag])
  await pendingRead
  expect(observer.getCurrentResult().data).toEqual([createdTag, existingTag])
})

it.each(['dify', 'external'] as const)(
  'refreshes shared binding counts after deleting a %s Agent',
  async (source) => {
    const client = createTestQueryClient()
    const tag = { id: 'research', name: 'Research', type: 'agent', binding_count: '1' }
    const unboundTag = { ...tag, binding_count: '0' }
    const catalog = consoleQuery.tags.get.queryOptions({ input: { query: { type: 'agent' } } })
    const search = consoleQuery.tags.get.queryKey({
      input: { query: { type: 'agent', keyword: 'Re' } },
    })
    client.setQueryData(catalog.queryKey, [tag])
    client.setQueryData(search, [tag])
    const observer = new QueryObserver(client, { ...catalog, queryFn: async () => [unboundTag] })
    onTestFinished(observer.subscribe(() => {}))

    call.mockResolvedValueOnce(undefined)
    const deletion =
      source === 'dify'
        ? consoleQuery.agent.byAgentId.delete.mutationOptions()
        : consoleQuery.externalAgents.byAgentId.delete.mutationOptions()
    await new MutationObserver(client, deletion).mutate({
      params: { agent_id: 'agent-1' },
    })

    expect(observer.getCurrentResult().data).toEqual([unboundTag])
    expect(client.getQueryState(search)?.isInvalidated).toBe(true)
  },
)
