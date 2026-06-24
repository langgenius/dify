import type {
  AppInstance,
  GetAppInstanceResponse,
  ListAppInstancesResponse,
} from '@dify/contracts/enterprise/types.gen'
import type { Getter } from 'jotai'
import { atom, createStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
  select?: (data: GetAppInstanceResponse) => AppInstance
}

type InfiniteQueryOptions = QueryOptions & {
  input?: (pageParam: number) => unknown
}

type QueryResult = {
  data?: unknown
}

const mockQueryResults = vi.hoisted(() => ({
  current: new Map<string, QueryResult>(),
}))

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom((get) => {
    const options = createOptions(get)
    const queryName = String(options.queryKey?.[0] ?? 'unknown')
    const queryResult = options.enabled === false
      ? undefined
      : mockQueryResults.current.get(queryName)
    const selectedData = options.select && queryResult?.data
      ? options.select(queryResult.data as GetAppInstanceResponse)
      : queryResult?.data

    return {
      ...options,
      data: selectedData,
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: Boolean(selectedData),
    }
  }),
  atomWithInfiniteQuery: (createOptions: (get: Getter) => InfiniteQueryOptions) => atom((get) => {
    const options = createOptions(get)
    const queryName = String(options.queryKey?.[0] ?? 'unknown')
    const queryResult = options.enabled === false
      ? undefined
      : mockQueryResults.current.get(queryName)

    return {
      ...options,
      data: queryResult?.data,
      hasNextPage: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      isSuccess: Boolean(queryResult?.data),
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
        listAppInstances: {
          infiniteOptions: (options: InfiniteQueryOptions) => ({
            ...options,
            queryKey: ['listAppInstances'],
          }),
        },
      },
    },
  },
}))

async function loadState() {
  return await import('../state')
}

function appInstance(overrides: Partial<AppInstance> = {}): AppInstance {
  return {
    id: 'app-instance-1',
    displayName: 'Deployment 1',
    description: '',
    sourceAppId: 'source-app-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AppInstance
}

function setListAppInstances(appInstances: AppInstance[]) {
  mockQueryResults.current.set('listAppInstances', {
    data: {
      pages: [
        {
          appInstances,
          pagination: {},
        } satisfies Partial<ListAppInstancesResponse>,
      ],
    },
  })
}

function setDeploymentRoute(store: ReturnType<typeof createStore>, appInstanceId = 'app-instance-1') {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/overview`,
    params: { appInstanceId },
  })
}

describe('deployments nav state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.current.clear()
  })

  it('should hide deployment nav items outside deployment routes', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.deploymentsNavItemsAtom)).toEqual([])
    expect(store.get(state.deploymentsNavCurrentItemAtom)).toBeUndefined()
  })

  it('should append the current route item when it is missing from the list query', async () => {
    const state = await loadState()
    const store = createStore()
    setDeploymentRoute(store)
    setListAppInstances([
      appInstance({
        id: 'app-instance-2',
        displayName: 'Deployment 2',
      }),
    ])
    mockQueryResults.current.set('getAppInstance', {
      data: {
        appInstance: appInstance(),
      },
    })

    expect(store.get(state.deploymentsNavItemsAtom)).toMatchObject([
      {
        id: 'app-instance-2',
        name: 'Deployment 2',
        link: '/deployments/app-instance-2/overview',
      },
      {
        id: 'app-instance-1',
        name: 'Deployment 1',
        link: '/deployments/app-instance-1/overview',
      },
    ])
    expect(store.get(state.deploymentsNavCurrentItemAtom)).toMatchObject({
      id: 'app-instance-1',
      name: 'Deployment 1',
    })
  })

  it('should use the route id as a fallback current item name', async () => {
    const state = await loadState()
    const store = createStore()
    setDeploymentRoute(store)
    setListAppInstances([])

    expect(store.get(state.deploymentsNavItemsAtom)).toMatchObject([
      {
        id: 'app-instance-1',
        name: 'app-instance-1',
        link: '/deployments/app-instance-1/overview',
      },
    ])
  })
})
