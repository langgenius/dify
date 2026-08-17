import { act, renderHook } from '@testing-library/react'
import { useDatasetList, useInvalidDatasetList } from '../use-dataset-list'

const infiniteOptionsMock = vi.hoisted(() => vi.fn((options: unknown) => options))
const invalidateQueriesMock = vi.hoisted(() => vi.fn())
const useInfiniteQueryMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: useInfiniteQueryMock,
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    datasets: {
      get: {
        infiniteOptions: infiniteOptionsMock,
        key: () => ['datasets'],
      },
    },
  },
}))

type CapturedOptions = {
  getNextPageParam: (lastPage: { has_more: boolean; page: number }) => number | undefined
  initialPageParam: number
  input: (pageParam: unknown) => {
    query: Record<string, unknown>
  }
}

describe('useDatasetList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps list filters to the generated dataset contract', () => {
    renderHook(() =>
      useDatasetList({
        creatorIds: ['creator-1', 'creator-2'],
        includeAll: true,
        keyword: 'handbook',
        tagIds: ['tag-1'],
      }),
    )

    const options = infiniteOptionsMock.mock.calls[0]![0] as CapturedOptions
    expect(options.input(2)).toEqual({
      query: {
        creator_ids: ['creator-1', 'creator-2'],
        include_all: true,
        keyword: 'handbook',
        limit: 30,
        page: 2,
        tag_ids: ['tag-1'],
      },
    })
    expect(options.initialPageParam).toBe(1)
    expect(options.getNextPageParam({ has_more: true, page: 2 })).toBe(3)
    expect(options.getNextPageParam({ has_more: false, page: 2 })).toBeUndefined()
    expect(useInfiniteQueryMock).toHaveBeenCalledWith(options)
  })

  it('omits empty optional filters', () => {
    renderHook(() =>
      useDatasetList({
        creatorIds: [],
        includeAll: false,
        keyword: '',
        tagIds: [],
      }),
    )

    const options = infiniteOptionsMock.mock.calls[0]![0] as CapturedOptions
    expect(options.input(1)).toEqual({
      query: {
        include_all: false,
        limit: 30,
        page: 1,
      },
    })
  })

  it('invalidates the generated dataset query', () => {
    const { result } = renderHook(() => useInvalidDatasetList())

    act(() => result.current())

    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['datasets'] })
  })
})
