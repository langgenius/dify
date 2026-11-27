import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import { MutationCache, MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import { createMutationInvalidation } from '../mutation-invalidation'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
// boundary: supply the Console API response while the generated mutation executes its cache policy.
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call } }))

it.each(['rename', 'delete'] as const)(
  'syncs Agent tags, roster, detail and Workflow options after %s',
  async (operation) => {
    // The tag's own catalogs are written from the response; the fallback refreshes the rest.
    const client = createTestQueryClient(undefined, { invalidation: createMutationInvalidation() })
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
      // The catalog refresh no longer holds the rename.
      await vi.waitFor(() => expect(client.getQueryState(financeSearch)?.isInvalidated).toBe(true))
    } else {
      call.mockResolvedValueOnce(undefined)
      await new MutationObserver(client, consoleQuery.tags.byTagId.delete.mutationOptions()).mutate(
        { params },
      )
    }

    await vi.waitFor(() => expect(client.getQueryState(agentResults[0]!)?.isInvalidated).toBe(true))
    // The policy cancels the unobserved pre-write read before writing: whoever awaits it gets
    // the catalog as it was when the read started.
    staleRead.resolve([agentTag])
    await expect(pendingRead).resolves.toEqual([agentTag])
    for (const key of agentResults) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryData(appCatalog)).toEqual([appTag])
    expect(client.getQueryState(appCatalog)?.isInvalidated).toBe(true)
    // A renamed or deleted tag may be on any tagged resource, so app lists refresh too.
    expect(client.getQueryState(appResults)?.isInvalidated).toBe(true)
  },
)

it.each(['rename', 'delete'] as const)(
  'keeps the %s over an unobserved Agent tag catalog read started before it',
  async (operation) => {
    const client = createTestQueryClient()
    const tag = { id: 'agent-tag', name: 'Research', type: 'agent' }
    const otherTag = { id: 'other-tag', name: 'Finance', type: 'agent' }
    const catalog = consoleQuery.tags.get.queryKey({ input: { query: { type: 'agent' } } })
    client.setQueryData(catalog, [tag, otherTag])
    const staleRead = createDeferred<TagResponse[]>()
    call.mockReturnValueOnce(staleRead.promise)
    const pendingRead = client
      .query(
        consoleQuery.tags.get.queryOptions({ input: { query: { type: 'agent' } }, staleTime: 0 }),
      )
      .catch(() => undefined)

    const params = { tag_id: tag.id }
    const renamedTag = { ...tag, name: 'Research 2' }
    if (operation === 'rename') {
      call.mockResolvedValueOnce(renamedTag)
      await new MutationObserver(client, consoleQuery.tags.byTagId.patch.mutationOptions()).mutate({
        params,
        body: { name: renamedTag.name },
      })
    } else {
      call.mockResolvedValueOnce(undefined)
      await new MutationObserver(client, consoleQuery.tags.byTagId.delete.mutationOptions()).mutate(
        { params },
      )
    }
    staleRead.resolve([tag, otherTag])
    await pendingRead

    expect(client.getQueryData(catalog)).toEqual(
      operation === 'rename' ? [renamedTag, otherTag] : [otherTag],
    )
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

it('refreshes binding counts in Agent tag catalogs through the fallback after deleting an Agent', async () => {
  const invalidation = createMutationInvalidation()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _result, mutation) => invalidation.onMutationSuccess(mutation),
    }),
  })
  onTestFinished(invalidation.attach(client))
  onTestFinished(() => client.clear())
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
  // The fallback skips data written after the request succeeded.
  await new Promise((resolve) => setTimeout(resolve, 2))

  call.mockResolvedValueOnce(undefined)
  await new MutationObserver(client, consoleQuery.agent.byAgentId.delete.mutationOptions()).mutate({
    params: { agent_id: 'agent-1' },
  })

  await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual([unboundTag]))
  expect(client.getQueryState(search)?.isInvalidated).toBe(true)
})
