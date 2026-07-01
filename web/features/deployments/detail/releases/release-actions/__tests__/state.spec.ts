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

function setDeploymentRoute(store: ReturnType<typeof createStore>, appInstanceId = 'app-instance-1') {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/releases`,
    params: { appInstanceId },
  })
}

describe('deployment release actions state', () => {
  it('should gate action queries until route and menu state are ready', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.deployReleaseMenuAppInstanceQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })

    setDeploymentRoute(store)

    expect(store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)).toMatchObject({
      enabled: false,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    store.set(state.deployReleaseMenuOpenAtom, true)

    expect(store.get(state.deployReleaseMenuEnvironmentDeploymentsQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
    expect(store.get(state.deployReleaseMenuAppInstanceQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })

  it('should open one secondary dialog at a time and close the menu', async () => {
    const state = await loadState()
    const store = createStore()

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
