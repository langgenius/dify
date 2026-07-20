import type { Getter } from 'jotai'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  placeholderData?: unknown
  queryKey?: readonly unknown[]
}

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) =>
    atom((get) => ({
      ...createOptions(get),
      data: undefined,
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: false,
    })),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      releaseService: {
        listReleaseSummaries: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['listReleaseSummaries', options.input],
          }),
        },
      },
    },
  },
}))

async function loadState() {
  return await import('../state')
}

function setDeploymentRoute(
  store: ReturnType<typeof createStore>,
  appInstanceId = 'app-instance-1',
) {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/overview`,
    params: { appInstanceId },
  })
}

describe('deployment releases state', () => {
  it('should gate release history query until route state is ready', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.releaseHistoryQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
  })

  it('should build release history input from the current page', async () => {
    const state = await loadState()
    const store = createStore()
    setDeploymentRoute(store)

    store.set(state.setReleaseHistoryCurrentPageAtom, -1)
    expect(store.get(state.releaseHistoryCurrentPageAtom)).toBe(0)

    store.set(state.setReleaseHistoryCurrentPageAtom, 2)
    expect(store.get(state.releaseHistoryQueryAtom)).toMatchObject({
      enabled: true,
      input: {
        params: { appInstanceId: 'app-instance-1' },
        query: {
          pageNumber: 3,
        },
      },
    })
  })

  it('should adjust the release page only when deleting the last row on a later page', async () => {
    const state = await loadState()
    const store = createStore()

    store.set(state.setReleaseHistoryCurrentPageAtom, 2)
    store.set(state.adjustReleaseHistoryPageAfterDeleteAtom, 2)
    expect(store.get(state.releaseHistoryCurrentPageAtom)).toBe(2)

    store.set(state.adjustReleaseHistoryPageAfterDeleteAtom, 1)
    expect(store.get(state.releaseHistoryCurrentPageAtom)).toBe(1)
  })
})
