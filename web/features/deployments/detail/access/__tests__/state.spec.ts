import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
}

const mockAccessSettingsQueryOptions = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        getAccessSettings: {
          queryOptions: (options: QueryOptions) => {
            mockAccessSettingsQueryOptions(options)
            return {
              ...options,
              queryKey: ['getAccessSettings', options.input],
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
    pathname: `/deployments/${appInstanceId}/access`,
    params: { appInstanceId },
  })
}

describe('deployment access state', () => {
  beforeEach(() => {
    mockAccessSettingsQueryOptions.mockClear()
  })

  it('should gate access queries until a route app instance exists', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.get(state.accessSettingsQueryAtom)
    expect(mockAccessSettingsQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: skipToken,
    })

    setDeploymentRoute(store)
    store.get(state.accessSettingsQueryAtom)

    expect(mockAccessSettingsQueryOptions).toHaveBeenLastCalledWith({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })
})
