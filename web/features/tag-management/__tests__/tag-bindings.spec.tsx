import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import { QueryObserver } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useApplyTagBindingsMutation } from '../tag-bindings'

const { bindTag, unbindTag } = vi.hoisted(() => ({ bindTag: vi.fn(), unbindTag: vi.fn() }))
// boundary: control the two independent tag-binding requests and their completion order.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: {
      ...actual.consoleClient,
      tagBindings: {
        ...actual.consoleClient.tagBindings,
        post: bindTag,
        remove: { ...actual.consoleClient.tagBindings.remove, post: unbindTag },
      },
    },
  }
})
const appKeys = () => [
  consoleQuery.apps.get.key(),
  consoleQuery.apps.starred.get.key(),
  consoleQuery.apps.recent.get.key(),
]
const tagKey = (type: TagType) =>
  consoleQuery.tags.get.key({ type: 'query', input: { query: { type } } })
function renderMutation() {
  const { queryClient, wrapper } = createConsoleQueryWrapper()
  for (const key of [...appKeys(), tagKey('app'), tagKey('knowledge')])
    queryClient.setQueryData(key, [])
  return { queryClient, ...renderHook(() => useApplyTagBindingsMutation(), { wrapper }) }
}
beforeEach(() => {
  bindTag.mockResolvedValue(undefined)
  unbindTag.mockResolvedValue(undefined)
})

it('batches only added and removed tags, then invalidates affected app lists and tags', async () => {
  const { queryClient, result } = renderMutation()
  await act(async () => {
    await result.current.mutateAsync({
      currentTagIds: ['tag-1', 'tag-2'],
      nextTagIds: ['tag-2', 'tag-3', 'tag-4'],
      targetId: 'app-1',
      type: 'app',
    })
  })
  expect(bindTag).toHaveBeenCalledExactlyOnceWith({
    body: { tag_ids: ['tag-3', 'tag-4'], target_id: 'app-1', type: 'app' },
  })
  expect(unbindTag).toHaveBeenCalledExactlyOnceWith({
    body: { tag_ids: ['tag-1'], target_id: 'app-1', type: 'app' },
  })
  for (const key of [...appKeys(), tagKey('app')])
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(tagKey('knowledge'))?.isInvalidated).toBe(false)
})

it('skips unchanged bindings and invalidates only the selected tag category', async () => {
  const { queryClient, result } = renderMutation()
  await act(async () => {
    await result.current.mutateAsync({
      currentTagIds: ['tag-1'],
      nextTagIds: ['tag-1'],
      targetId: 'knowledge-1',
      type: 'knowledge',
    })
  })
  expect(bindTag).not.toHaveBeenCalled()
  expect(unbindTag).not.toHaveBeenCalled()
  expect(queryClient.getQueryState(tagKey('knowledge'))?.isInvalidated).toBe(true)
  for (const key of [...appKeys(), tagKey('app')])
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
})

it('refreshes Agent tags, lists and the edited detail after both writes settle on partial failure', async () => {
  const { queryClient, result } = renderMutation()
  const detailKey = (agentId: string) =>
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } })
  const affected = [
    tagKey('agent'),
    consoleQuery.agent.get.key({ type: 'infinite' }),
    consoleQuery.agent.inviteOptions.get.key({ type: 'infinite' }),
    detailKey('agent-1'),
  ]
  const unaffected = [...appKeys(), tagKey('app'), tagKey('knowledge'), detailKey('agent-2')]
  for (const key of [...affected, ...unaffected]) queryClient.setQueryData(key, [])

  const removal = createDeferred()
  bindTag.mockRejectedValueOnce(new Error('Binding failed'))
  unbindTag.mockReturnValueOnce(removal.promise)
  await act(async () => {
    const rejected = expect(
      result.current.mutateAsync({
        currentTagIds: ['old'],
        nextTagIds: ['new'],
        targetId: 'agent-1',
        type: 'agent',
      }),
    ).rejects.toThrow('Binding failed')
    await waitFor(() => expect(unbindTag).toHaveBeenCalledOnce())
    expect(queryClient.getQueryState(tagKey('agent'))?.isInvalidated).toBe(false)
    removal.resolve()
    await rejected
  })
  for (const key of affected) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  for (const key of unaffected) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
})

it('refreshes the binding count without waiting for a catalog read started before unbinding', async () => {
  const { queryClient, result } = renderMutation()
  const boundTag = { id: 'tag-1', name: 'Research', type: 'agent', binding_count: '1' }
  const unboundTag = { ...boundTag, binding_count: '0' }
  const staleRead = createDeferred<(typeof boundTag)[]>()
  onTestFinished(() => staleRead.resolve([boundTag]))
  const readCatalog = vi.fn().mockReturnValueOnce(staleRead.promise).mockResolvedValue([unboundTag])
  const observer = new QueryObserver(queryClient, {
    queryKey: tagKey('agent'),
    queryFn: readCatalog,
  })
  onTestFinished(observer.subscribe(() => {}))
  expect(readCatalog).toHaveBeenCalledOnce()

  await act(async () => {
    const save = result.current.mutateAsync({
      currentTagIds: [boundTag.id],
      nextTagIds: [],
      targetId: 'agent-1',
      type: 'agent',
    })
    await waitFor(() => expect(readCatalog).toHaveBeenCalledTimes(2))
    await save
  })
  staleRead.resolve([boundTag])
  await staleRead.promise
  expect(observer.getCurrentResult().data).toEqual([unboundTag])
})
