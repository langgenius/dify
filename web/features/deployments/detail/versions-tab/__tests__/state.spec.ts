import type { Release } from '@dify/contracts/enterprise/types.gen'
import type { Getter } from 'jotai'
import { ReleaseSource } from '@dify/contracts/enterprise/types.gen'
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

type MutationOptions = {
  mutationFn?: (variables: unknown) => Promise<unknown>
  mutationKey?: readonly unknown[]
}

const mockExportReleaseDsl = vi.hoisted(() => vi.fn())

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom(get => ({
    ...createOptions(get),
    data: undefined,
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: false,
  })),
  atomWithMutation: (createOptions: () => MutationOptions) => atom(() => createOptions()),
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
        deleteRelease: {
          mutationOptions: () => ({ mutationKey: ['deleteRelease'] }),
        },
        listReleaseSummaries: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['listReleaseSummaries', options.input],
          }),
        },
        updateRelease: {
          mutationOptions: () => ({ mutationKey: ['updateRelease'] }),
        },
      },
    },
  },
}))

vi.mock('../release-dsl-export', () => ({
  exportReleaseDsl: (...args: unknown[]) => mockExportReleaseDsl(...args),
}))

async function loadState() {
  return await import('../state')
}

function createRelease(): Release {
  return {
    id: 'release-1',
    appInstanceId: 'app-instance-1',
    displayName: 'Release 1',
    description: '',
    source: ReleaseSource.RELEASE_SOURCE_UPLOAD,
    gateCommitId: 'commit-1',
    requiredSlots: [],
    createdBy: {
      id: 'account-1',
      displayName: 'Dify Admin',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function setDeploymentRoute(store: ReturnType<typeof createStore>, appInstanceId = 'app-instance-1') {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/overview`,
    params: { appInstanceId },
  })
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

  it('should scope deploy menu queries to the open release id', async () => {
    const state = await loadState()
    const store = createStore()
    setDeploymentRoute(store)

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

  it('should expose release mutation atoms from state', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.deleteReleaseMutationAtom)).toMatchObject({
      mutationKey: ['deleteRelease'],
    })
    expect(store.get(state.updateReleaseMutationAtom)).toMatchObject({
      mutationKey: ['updateRelease'],
    })
  })

  it('should expose release DSL export as a mutation atom', async () => {
    const state = await loadState()
    const store = createStore()
    const mutationOptions = store.get(state.exportReleaseDslMutationAtom) as unknown as MutationOptions
    const release = createRelease()

    await mutationOptions.mutationFn?.({
      release,
      releaseId: release.id,
      appInstanceName: 'Deployment 1',
    })

    expect(mutationOptions.mutationKey).toEqual(['deployments', 'release-dsl-export'])
    expect(mockExportReleaseDsl).toHaveBeenCalledWith({
      release,
      releaseId: release.id,
      appInstanceName: 'Deployment 1',
    })
  })
})
