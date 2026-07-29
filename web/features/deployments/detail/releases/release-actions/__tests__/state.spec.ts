import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
}

const mockGetAppInstanceQueryOptions = vi.hoisted(() => vi.fn())
const mockListEnvironmentDeploymentsQueryOptions = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        getAppInstance: {
          queryOptions: (options: QueryOptions) => {
            mockGetAppInstanceQueryOptions(options)
            return {
              ...options,
              queryKey: ['getAppInstance', options.input],
              queryFn: async () => undefined,
            }
          },
        },
      },
      deploymentService: {
        listEnvironmentDeployments: {
          queryOptions: (options: QueryOptions) => {
            mockListEnvironmentDeploymentsQueryOptions(options)
            return {
              ...options,
              queryKey: ['listEnvironmentDeployments', options.input],
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
    pathname: `/deployments/${appInstanceId}/releases`,
    params: { appInstanceId },
  })
}

describe('deployment release actions state', () => {
  beforeEach(() => {
    mockGetAppInstanceQueryOptions.mockClear()
    mockListEnvironmentDeploymentsQueryOptions.mockClear()
  })

  it('should gate action queries until route and menu state are ready', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)
    expect(mockListEnvironmentDeploymentsQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: skipToken,
    })
    store.get(state.deployReleaseMenuAppInstanceQueryAtom)
    expect(mockGetAppInstanceQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: skipToken,
    })

    setDeploymentRoute(store)

    store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)
    expect(mockListEnvironmentDeploymentsQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    store.set(state.deployReleaseMenuOpenAtom, true)

    store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)
    expect(mockListEnvironmentDeploymentsQueryOptions).toHaveBeenLastCalledWith({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
    store.get(state.deployReleaseMenuAppInstanceQueryAtom)
    expect(mockGetAppInstanceQueryOptions).toHaveBeenLastCalledWith({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })

  it('should open one secondary dialog at a time and close the menu', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.set(state.deployReleaseMenuOpenAtom, true)
    store.set(state.openDeleteReleaseDialogAtom)

    expect(store.get(state.deployReleaseMenuOpenAtom)).toBe(false)
    expect(store.get(state.editReleaseDialogOpenAtom)).toBe(false)
    expect(store.get(state.deleteReleaseDialogOpenAtom)).toBe(true)

    store.set(state.deployReleaseMenuOpenAtom, true)
    store.set(state.openEditReleaseDialogAtom)

    expect(store.get(state.deployReleaseMenuOpenAtom)).toBe(false)
    expect(store.get(state.editReleaseDialogOpenAtom)).toBe(true)
    expect(store.get(state.deleteReleaseDialogOpenAtom)).toBe(false)
  })
})
