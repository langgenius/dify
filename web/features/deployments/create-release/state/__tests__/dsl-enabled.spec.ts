import type { Getter } from 'jotai'
import { QueryClient } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type QueryResult = {
  data?: unknown
  isError?: boolean
  isFetching?: boolean
  isLoading?: boolean
  isSuccess?: boolean
}

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryFn?: () => unknown
  queryKey?: readonly unknown[]
  retry?: boolean
}

type InfiniteQueryOptions = QueryOptions & {
  input?: (pageParam: number) => unknown
}

type MutationResult = {
  isPending: boolean
  mutateAsync: ReturnType<typeof vi.fn>
}

const mockQueryResults = vi.hoisted(() => ({
  current: new Map<string, QueryResult>(),
}))

const mockCreateReleaseMutation = vi.hoisted<{ current: MutationResult }>(() => ({
  current: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
}))

vi.mock('../../../shared/domain/feature-flags', () => ({
  isDeploymentDslImportEnabled: true,
}))

vi.mock('jotai-tanstack-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai-tanstack-query')>()

  return {
    ...actual,
    atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom((get) => {
      const options = createOptions(get)
      const queryKey = Array.isArray(options.queryKey) ? options.queryKey[0] : undefined
      const queryName = typeof queryKey === 'string' ? queryKey : 'unknown'
      const queryResult = options.enabled === false
        ? undefined
        : mockQueryResults.current.get(queryName)

      return {
        ...options,
        data: undefined,
        isError: false,
        isFetching: false,
        isLoading: false,
        isSuccess: false,
        ...queryResult,
      }
    }),
    atomWithInfiniteQuery: (createOptions: (get: Getter) => InfiniteQueryOptions) => atom((get) => {
      const options = createOptions(get)
      const queryKey = Array.isArray(options.queryKey) ? options.queryKey[0] : undefined
      const queryName = typeof queryKey === 'string' ? queryKey : 'unknown'
      const queryResult = options.enabled === false
        ? undefined
        : mockQueryResults.current.get(queryName)

      return {
        ...options,
        data: undefined,
        hasNextPage: false,
        isError: false,
        isFetching: false,
        isFetchingNextPage: false,
        isLoading: false,
        isPlaceholderData: false,
        isSuccess: false,
        ...queryResult,
      }
    }),
    atomWithMutation: () => atom(() => mockCreateReleaseMutation.current),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      list: {
        infiniteOptions: (options: InfiniteQueryOptions) => ({
          ...options,
          queryKey: ['sourceApps', options.input],
        }),
      },
    },
    enterprise: {
      releaseService: {
        listReleaseSummaries: {
          key: ({ input }: { input?: unknown } = {}) => input === undefined ? ['listReleaseSummaries'] : ['listReleaseSummaries', input],
        },
        listReleases: {
          key: ({ input }: { input?: unknown } = {}) => input === undefined ? ['listReleases'] : ['listReleases', input],
        },
        precheckRelease: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['precheckRelease', options.input],
          }),
        },
        createRelease: {
          mutationOptions: () => ({ mutationKey: ['createRelease'] }),
        },
      },
    },
  },
}))

async function loadState() {
  return await import('../index')
}

async function mountedStore() {
  const state = await loadState()
  const store = createStore()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  store.set(queryClientAtom, queryClient)
  const unsubscribe = store.sub(state.createReleaseFormIsSubmittingAtom, () => undefined)

  return {
    state,
    store,
    unsubscribe,
  }
}

function workflowDsl() {
  return [
    'app:',
    '  mode: workflow',
    '  name: Release source',
  ].join('\n')
}

function setDslFileContentResult(overrides: QueryResult = {}) {
  mockQueryResults.current.set('createReleaseDslFileContent', {
    data: workflowDsl(),
    isSuccess: true,
    ...overrides,
  })
}

function setPrecheckReleaseResult(overrides: QueryResult = {}) {
  mockQueryResults.current.set('precheckRelease', {
    data: {
      gateCommitId: 'gate-commit-1',
      canCreate: true,
      unsupportedNodes: [],
    },
    isSuccess: true,
    ...overrides,
  })
}

describe('create release state with DSL import enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.current.clear()
    mockCreateReleaseMutation.current = {
      isPending: false,
      mutateAsync: vi.fn(),
    }
  })

  it('should enable source app search with the current search text while creating from an app', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    store.set(state.createReleaseSourceAppSearchTextAtom, 'customer')

    const sourceAppsQuery = store.get(state.createReleaseSourceAppsQueryAtom) as unknown as InfiniteQueryOptions

    expect(sourceAppsQuery.enabled).toBe(true)
    expect(sourceAppsQuery.input?.(2)).toEqual({
      query: {
        page: 2,
        limit: 20,
        name: 'customer',
        mode: 'workflow',
      },
    })

    unsubscribe()
  })

  it('should submit a DSL release with encoded workflow content', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const response = {
      release: {
        displayName: 'Release from DSL',
      },
    }
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })
    mockCreateReleaseMutation.current.mutateAsync.mockResolvedValue(response)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    store.set(state.selectCreateReleaseSourceModeAtom, 'dsl')
    store.set(state.updateCreateReleaseDslFileAtom, file)
    setDslFileContentResult()
    setPrecheckReleaseResult()
    store.set(state.createReleaseNameFieldAtom, ' Release from DSL ')
    store.set(state.createReleaseDescriptionFieldAtom, ' Imported workflow ')

    const result = await store.set(state.submitCreateReleaseFormAtom)
    const encodedDslContent = store.get(state.createReleaseEncodedDslContentAtom)

    expect(result).toBe(response)
    expect(encodedDslContent).not.toBe('')
    expect(mockCreateReleaseMutation.current.mutateAsync).toHaveBeenCalledWith({
      body: {
        appInstanceId: 'app-instance-1',
        displayName: 'Release from DSL',
        description: 'Imported workflow',
        createAppInstance: false,
        dsl: encodedDslContent,
      },
    })

    unsubscribe()
  })
})
