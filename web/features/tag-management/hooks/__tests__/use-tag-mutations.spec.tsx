import { act, renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useApplyTagBindingsMutation } from '../use-tag-mutations'

const { bindTag, unbindTag } = vi.hoisted(() => ({ bindTag: vi.fn(), unbindTag: vi.fn() }))
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
const tagKey = (type: 'app' | 'knowledge') =>
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
