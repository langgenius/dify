import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
}

const mockOverviewQueryOptions = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        getAppInstanceOverview: {
          queryOptions: (options: QueryOptions) => {
            mockOverviewQueryOptions(options)
            return {
              ...options,
              queryKey: ['getAppInstanceOverview', options.input],
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

describe('deployment overview state', () => {
  beforeEach(() => {
    mockOverviewQueryOptions.mockClear()
  })

  it('should disable overview query with skipToken until route state is ready', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.get(state.deploymentOverviewQueryAtom)

    expect(mockOverviewQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: skipToken,
    })
  })

  it('should build overview query input from route identity', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    setDeploymentRoute(store)
    store.get(state.deploymentOverviewQueryAtom)

    expect(mockOverviewQueryOptions).toHaveBeenLastCalledWith({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })
})
