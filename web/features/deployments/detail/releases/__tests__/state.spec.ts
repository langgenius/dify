import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  placeholderData?: unknown
  queryKey?: readonly unknown[]
}

const mockReleaseSummariesQueryOptions = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      releaseService: {
        listReleaseSummaries: {
          queryOptions: (options: QueryOptions) => {
            mockReleaseSummariesQueryOptions(options)
            return {
              ...options,
              queryKey: ['listReleaseSummaries', options.input],
              queryFn: async () => undefined,
            }
          },
        },
      },
    },
  },
}))

async function loadState() {
  return await import('../state')
}

function setDeploymentRoute(
  store: ReturnType<typeof createQueryAtomTestStore>['store'],
  appInstanceId = 'app-instance-1',
) {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/overview`,
    params: { appInstanceId },
  })
}

describe('deployment releases state', () => {
  beforeEach(() => {
    mockReleaseSummariesQueryOptions.mockClear()
  })

  it('should gate release history query until route state is ready', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.get(state.releaseHistoryQueryAtom)
    expect(mockReleaseSummariesQueryOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: false,
        input: skipToken,
      }),
    )
  })

  it('should build release history input from the current page', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()
    setDeploymentRoute(store)

    store.set(state.setReleaseHistoryCurrentPageAtom, -1)
    expect(store.get(state.releaseHistoryCurrentPageAtom)).toBe(0)

    store.set(state.setReleaseHistoryCurrentPageAtom, 2)
    store.get(state.releaseHistoryQueryAtom)
    expect(mockReleaseSummariesQueryOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        input: expect.objectContaining({
          params: { appInstanceId: 'app-instance-1' },
          query: expect.objectContaining({
            pageNumber: 3,
          }),
        }),
      }),
    )
  })

  it('should adjust the release page only when deleting the last row on a later page', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.set(state.setReleaseHistoryCurrentPageAtom, 2)
    store.set(state.adjustReleaseHistoryPageAfterDeleteAtom, 2)
    expect(store.get(state.releaseHistoryCurrentPageAtom)).toBe(2)

    store.set(state.adjustReleaseHistoryPageAfterDeleteAtom, 1)
    expect(store.get(state.releaseHistoryCurrentPageAtom)).toBe(1)
  })
})
