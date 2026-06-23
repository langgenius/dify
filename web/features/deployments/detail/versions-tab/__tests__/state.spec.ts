import type { Getter } from 'jotai'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  placeholderData?: unknown
  queryKey?: readonly unknown[]
}

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom(get => ({
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
      appInstanceService: {
        getAppInstance: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAppInstance', options.input],
          }),
        },
      },
      deploymentService: {
        listEnvironmentDeployments: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['listEnvironmentDeployments', options.input],
          }),
        },
      },
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

describe('versions tab state', () => {
  it('should gate release history and menu queries until route and menu state are ready', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.releaseHistoryQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.deployReleaseMenuAppInstanceQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
  })

  it('should build release history input from the current page', async () => {
    const state = await loadState()
    const store = createStore()
    store.set(deploymentRouteAppInstanceIdAtom, 'app-instance-1')

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

  it('should scope deploy menu queries to the open release id', async () => {
    const state = await loadState()
    const store = createStore()
    store.set(deploymentRouteAppInstanceIdAtom, 'app-instance-1')

    store.set(state.setDeployReleaseMenuOpenAtom, {
      releaseId: 'release-1',
      open: true,
    })

    expect(store.get(state.deployReleaseMenuOpenReleaseIdAtom)).toBe('release-1')
    expect(store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
    expect(store.get(state.deployReleaseMenuAppInstanceQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    store.set(state.setDeployReleaseMenuOpenAtom, {
      releaseId: 'release-2',
      open: false,
    })
    expect(store.get(state.deployReleaseMenuOpenReleaseIdAtom)).toBe('release-1')

    store.set(state.setDeployReleaseMenuOpenAtom, {
      releaseId: 'release-1',
      open: false,
    })
    expect(store.get(state.deployReleaseMenuOpenReleaseIdAtom)).toBeUndefined()
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
