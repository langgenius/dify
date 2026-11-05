import { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { goldenQuestionQueriesKey } from '../quality-model'

const goldenQuestions = consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions

function seedGoldenQuestionQueries(queryClient: QueryClient) {
  const page = goldenQuestions.get.queryOptions({
    input: { params: { control_space_id: 'space-1' }, query: { limit: 100 } },
  })
  const nextPage = goldenQuestions.get.queryOptions({
    input: { params: { control_space_id: 'space-1' }, query: { cursor: 'next', limit: 100 } },
  })
  const activeCountKey = [...page.queryKey, 'active-count']
  const list = goldenQuestions.get.infiniteOptions({
    input: () => ({ params: { control_space_id: 'space-1' }, query: { limit: 50 } }),
    getNextPageParam: () => undefined,
    initialPageParam: null,
  })
  const otherSpacePage = goldenQuestions.get.queryOptions({
    input: { params: { control_space_id: 'space-2' }, query: { limit: 100 } },
  })
  const keys = {
    activeCount: activeCountKey,
    list: list.queryKey,
    nextPage: nextPage.queryKey,
    otherSpacePage: otherSpacePage.queryKey,
    page: page.queryKey,
  }
  for (const key of Object.values(keys)) queryClient.setQueryData(key, {})
  return keys
}

describe('goldenQuestionQueriesKey', () => {
  it('invalidates the active count and its source pages along with the infinite list', async () => {
    const queryClient = new QueryClient()
    const keys = seedGoldenQuestionQueries(queryClient)

    await queryClient.invalidateQueries({ queryKey: goldenQuestionQueriesKey('space-1') })

    const invalidated = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated ?? false
    expect(invalidated(keys.list)).toBe(true)
    expect(invalidated(keys.activeCount)).toBe(true)
    expect(invalidated(keys.page)).toBe(true)
    expect(invalidated(keys.nextPage)).toBe(true)
    expect(invalidated(keys.otherSpacePage)).toBe(false)
  })
})
