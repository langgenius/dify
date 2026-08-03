import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
}

const mockDeveloperApiSettingsQueryOptions = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        getDeveloperApiSettings: {
          queryOptions: (options: QueryOptions) => {
            mockDeveloperApiSettingsQueryOptions(options)
            return {
              ...options,
              queryKey: ['getDeveloperApiSettings', options.input],
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
    pathname: `/deployments/${appInstanceId}/api-tokens`,
    params: { appInstanceId },
  })
}

describe('deployment API tokens state', () => {
  beforeEach(() => {
    mockDeveloperApiSettingsQueryOptions.mockClear()
  })

  it('should gate API token queries until a route app instance exists', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

    store.get(state.developerApiSettingsQueryAtom)
    expect(mockDeveloperApiSettingsQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: skipToken,
    })

    setDeploymentRoute(store)
    store.get(state.developerApiSettingsQueryAtom)

    expect(mockDeveloperApiSettingsQueryOptions).toHaveBeenLastCalledWith({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })
})
