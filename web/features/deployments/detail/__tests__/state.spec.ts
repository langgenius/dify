import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import type { Getter } from 'jotai'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'

type QueryOptions = {
  data?: unknown
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
  refetchInterval?: (query: { state: { data?: unknown } }) => number | false
}

const mockEnvironmentDeploymentsData = vi.hoisted<{
  current?: { environmentDeployments: EnvironmentDeployment[] }
}>(() => ({}))

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom((get) => {
    const options = createOptions(get)
    return {
      ...options,
      data: options.queryKey?.[0] === 'listEnvironmentDeployments'
        ? mockEnvironmentDeploymentsData.current
        : undefined,
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: false,
    }
  }),
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
    },
  },
}))

async function loadState() {
  return await import('../state')
}

function setDeploymentRoute(store: ReturnType<typeof createStore>, appInstanceId = 'app-instance-1', tab = 'overview') {
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
    mockEnvironmentDeploymentsData.current = undefined
  })

  it('should disable detail queries with skipToken until a route app instance exists', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.deploymentDetailAppInstanceQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.deploymentEnvironmentDeploymentsQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
  })

  it('should build detail query inputs from route identity', async () => {
    const state = await loadState()
    const store = createStore()

    setDeploymentRoute(store)

    expect(store.get(state.deploymentDetailAppInstanceQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    const environmentDeploymentsQuery = store.get(state.deploymentEnvironmentDeploymentsQueryAtom) as unknown as QueryOptions
    expect(environmentDeploymentsQuery).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
    expect(environmentDeploymentsQuery.refetchInterval).toEqual(expect.any(Function))
  })

  it('should derive active detail tab from route pathname', async () => {
    const state = await loadState()
    const store = createStore()

    setDeploymentRoute(store, 'app-instance-1', 'releases')
    expect(store.get(state.deploymentDetailActiveTabAtom)).toBe('releases')

    setDeploymentRoute(store, 'app-instance-1', 'unknown')
    expect(store.get(state.deploymentDetailActiveTabAtom)).toBe('overview')
  })

  it('should derive runtime instance rows from environment deployments', async () => {
    const state = await loadState()
    const store = createStore()
    mockEnvironmentDeploymentsData.current = {
      environmentDeployments: [
        deploymentRow('running'),
        deploymentRow('undeployed', {
          status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED,
          currentRelease: undefined,
          desiredRelease: undefined,
          currentDeployment: undefined,
        }),
      ],
    }

    expect(store.get(state.deploymentRuntimeInstanceRowsAtom).map(row => row.environment.id)).toEqual(['running'])
  })
})
