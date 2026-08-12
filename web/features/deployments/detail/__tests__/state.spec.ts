import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
  refetchInterval?: (query: { state: { data?: unknown } }) => number | false
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
  tab = 'overview',
) {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/${tab}`,
    params: { appInstanceId },
  })
}

function deploymentRow(id: string, overrides: Partial<EnvironmentDeployment> = {}) {
  return {
    environment: {
      id,
      displayName: id,
    },
    status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
    currentRelease: {
      id: `release-${id}`,
    },
    desiredRelease: undefined,
    currentDeployment: {
      id: `deployment-${id}`,
    },
    ...overrides,
  } as EnvironmentDeployment
}

describe('deployment detail state', () => {
  beforeEach(() => {
    mockGetAppInstanceQueryOptions.mockClear()
    mockListEnvironmentDeploymentsQueryOptions.mockClear()
  })

  it('should disable detail queries with skipToken until a route app instance exists', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.get(state.deploymentDetailAppInstanceQueryAtom)
    expect(mockGetAppInstanceQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: skipToken,
    })
    store.get(state.deploymentEnvironmentDeploymentsQueryAtom)
    expect(mockListEnvironmentDeploymentsQueryOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: false,
        input: skipToken,
      }),
    )
  })

  it('should build detail query inputs from route identity', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    setDeploymentRoute(store)

    store.get(state.deploymentDetailAppInstanceQueryAtom)
    expect(mockGetAppInstanceQueryOptions).toHaveBeenLastCalledWith({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    store.get(state.deploymentEnvironmentDeploymentsQueryAtom)
    expect(mockListEnvironmentDeploymentsQueryOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        input: { params: { appInstanceId: 'app-instance-1' } },
        refetchInterval: expect.any(Function),
      }),
    )
  })

  it('should derive active detail tab from route pathname', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    setDeploymentRoute(store, 'app-instance-1', 'releases')
    expect(store.get(state.deploymentDetailActiveTabAtom)).toBe('releases')

    setDeploymentRoute(store, 'app-instance-1', 'unknown')
    expect(store.get(state.deploymentDetailActiveTabAtom)).toBe('overview')
  })

  it('should derive runtime instance rows from environment deployments', async () => {
    const state = await loadState()
    const { queryClient, store } = createQueryAtomTestStore()
    setDeploymentRoute(store)
    queryClient.setQueryData(
      ['listEnvironmentDeployments', { params: { appInstanceId: 'app-instance-1' } }],
      {
        environmentDeployments: [
          deploymentRow('running'),
          deploymentRow('undeployed', {
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED,
            currentRelease: undefined,
            desiredRelease: undefined,
            currentDeployment: undefined,
          }),
        ],
      },
    )

    expect(
      store.get(state.deploymentRuntimeInstanceRowsAtom).map((row) => row.environment.id),
    ).toEqual(['running'])
  })
})
