import type { Getter } from 'jotai'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
  refetchInterval?: (query: { state: { data?: unknown } }) => number | false
}

type MutationOptions = {
  mutationKey?: readonly unknown[]
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
  atomWithMutation: (createOptions: () => MutationOptions) => atom(() => createOptions()),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        get: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['appById', options.input],
          }),
        },
      },
    },
    enterprise: {
      appInstanceService: {
        getAppInstance: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAppInstance', options.input],
          }),
        },
        getAppInstanceOverview: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAppInstanceOverview', options.input],
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
        undeploy: {
          mutationOptions: () => ({ mutationKey: ['undeploy'] }),
        },
      },
    },
  },
}))

async function loadState() {
  return await import('../state')
}

function setDeploymentRoute(store: ReturnType<typeof createStore>, appInstanceId = 'app-instance-1') {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/overview`,
    params: { appInstanceId },
  })
}

describe('deployment detail state', () => {
  it('should disable detail queries with skipToken until a route app instance exists', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.deploymentDetailAppInstanceQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.deploymentDetailOverviewQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.deploymentEnvironmentDeploymentsQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.deploymentSourceAppQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
  })

  it('should build detail query inputs from route and source identities', async () => {
    const state = await loadState()
    const store = createStore()

    setDeploymentRoute(store)
    store.set(state.deploymentSourceAppIdAtom, 'source-app-1')

    expect(store.get(state.deploymentDetailAppInstanceQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
    expect(store.get(state.deploymentDetailOverviewQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    const environmentDeploymentsQuery = store.get(state.deploymentEnvironmentDeploymentsQueryAtom) as unknown as QueryOptions
    expect(environmentDeploymentsQuery).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
    expect(environmentDeploymentsQuery.refetchInterval).toEqual(expect.any(Function))

    expect(store.get(state.deploymentSourceAppQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { app_id: 'source-app-1' } },
    })
  })

  it('should expose deployment row mutations from state', async () => {
    const state = await loadState()
    const store = createStore()
    const undeployDeploymentMutationAtom = state.createUndeployDeploymentMutationAtom()

    expect(store.get(undeployDeploymentMutationAtom)).toMatchObject({
      mutationKey: ['undeploy'],
    })
  })
})
