import { act, waitFor } from '@testing-library/react'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useDatasetList, useInvalidDatasetList } from '../use-dataset-list'

const listDatasets = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'datasets.get': listDatasets }),
  }
})

const page = (pageNumber: number, hasMore: boolean) => ({
  data: [],
  has_more: hasMore,
  limit: 30,
  page: pageNumber,
  total: 0,
})

describe('useDatasetList', () => {
  beforeEach(() => {
    listDatasets.mockReset()
    listDatasets.mockImplementation(async ({ query }: { query: { page: number } }) =>
      page(query.page, query.page < 2),
    )
  })

  it('requests the filtered dataset pages and continues while more pages exist', async () => {
    const { result } = renderHookWithConsoleQuery(() =>
      useDatasetList({
        creatorIds: ['creator-1', 'creator-2'],
        includeAll: true,
        keyword: 'handbook',
        tagIds: ['tag-1'],
      }),
    )

    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    expect(listDatasets).toHaveBeenLastCalledWith({
      query: {
        creator_ids: ['creator-1', 'creator-2'],
        include_all: true,
        keyword: 'handbook',
        limit: 30,
        page: 1,
        tag_ids: ['tag-1'],
      },
    })

    await act(() => result.current.fetchNextPage())
    expect(listDatasets).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ page: 2 }),
    })
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
  })

  it('omits empty optional filters', async () => {
    renderHookWithConsoleQuery(() =>
      useDatasetList({ creatorIds: [], includeAll: false, keyword: '', tagIds: [] }),
    )

    await waitFor(() =>
      expect(listDatasets).toHaveBeenCalledWith({
        query: { include_all: false, limit: 30, page: 1 },
      }),
    )
  })

  it('refreshes the mounted dataset list when invalidated', async () => {
    const { result } = renderHookWithConsoleQuery(() => ({
      invalidate: useInvalidDatasetList(),
      list: useDatasetList({ creatorIds: [], includeAll: false, keyword: 'handbook', tagIds: [] }),
    }))
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))

    act(() => result.current.invalidate())

    await waitFor(() => expect(listDatasets).toHaveBeenCalledTimes(2))
  })
})
