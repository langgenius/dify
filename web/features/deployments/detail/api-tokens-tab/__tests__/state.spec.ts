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
      accessService: {
        getDeveloperApiSettings: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getDeveloperApiSettings', options.input],
          }),
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
    pathname: `/deployments/${appInstanceId}/api-tokens`,
    params: { appInstanceId },
  })
}

describe('deployment api tokens state', () => {
  it('should gate developer api settings until a route app instance exists', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.developerApiSettingsQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })

    setDeploymentRoute(store)

    expect(store.get(state.developerApiSettingsQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })
})
