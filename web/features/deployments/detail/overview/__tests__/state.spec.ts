import type { Getter } from 'jotai'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
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
      appInstanceService: {
        getAppInstanceOverview: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAppInstanceOverview', options.input],
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

describe('deployment overview state', () => {
  it('should disable overview query with skipToken until route state is ready', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.deploymentOverviewQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
  })

  it('should build overview query input from route identity', async () => {
    const state = await loadState()
    const store = createStore()

    setDeploymentRoute(store)

    expect(store.get(state.deploymentOverviewQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })
})
