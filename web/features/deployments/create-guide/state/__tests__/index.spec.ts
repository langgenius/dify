import type { Getter } from 'jotai'
import { atom, createStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dslFileAtom,
  effectiveMethodAtom,
  instanceNameAtom,
  methodAtom,
  releaseNameAtom,
  selectedAppAtom,
  stepAtom,
} from '../primitives'
import {
  dslDefaultAppNameAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
  sourceAppsQueryAtom,
} from '../source'
import {
  continueFromSourceAtom,
  selectDslFileAtom,
  selectMethodAtom,
  sourceCanGoNextAtom,
} from '../workflow'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
  retry?: boolean
}

type InfiniteQueryOptions = QueryOptions & {
  input?: (pageParam: number) => unknown
}

type QueryResult = {
  data?: unknown
  hasNextPage?: boolean
  isError?: boolean
  isFetching?: boolean
  isFetchingNextPage?: boolean
  isLoading?: boolean
  isPlaceholderData?: boolean
  isSuccess?: boolean
}

const mockQueryResults = vi.hoisted(() => ({
  current: new Map<string, QueryResult>(),
}))

vi.mock('jotai-tanstack-query', () => ({
  atomWithInfiniteQuery: (createOptions: (get: Getter) => InfiniteQueryOptions) => atom((get) => {
    const options = createOptions(get)
    const queryName = String(options.queryKey?.[0] ?? 'unknown')
    const queryResult = mockQueryResults.current.get(queryName)

    return {
      ...options,
      data: { pages: [{ data: [] }] },
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: Boolean(queryResult?.data),
      fetchNextPage: vi.fn(),
      ...queryResult,
    }
  }),
  atomWithMutation: () => atom(() => ({
    isPending: false,
    mutateAsync: vi.fn(),
  })),
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom((get) => {
    const options = createOptions(get)
    const queryName = String(options.queryKey?.[0] ?? 'unknown')
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
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      get: {
        infiniteOptions: (options: InfiniteQueryOptions) => ({
          ...options,
          queryKey: ['sourceApps'],
        }),
      },
    },
    enterprise: {
      appInstanceService: {
        listAppInstances: {
          infiniteOptions: (options: InfiniteQueryOptions) => ({
            ...options,
            queryKey: ['existingInstanceNames'],
          }),
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['instanceNameConflict'],
          }),
        },
      },
      environmentService: {
        listEnvironments: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['environments'],
          }),
        },
      },
      releaseService: {
        computeDeploymentOptions: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['deploymentOptions'],
          }),
        },
        precheckRelease: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['precheckRelease'],
          }),
        },
      },
    },
  },
}))

function workflowDsl() {
  return [
    'app:',
    '  mode: workflow',
    '  name: Imported guide',
  ].join('\n')
}

describe('create deployment guide state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.current.clear()
  })

  it('should keep the guide on source app mode when DSL import is disabled', () => {
    const store = createStore()

    store.set(selectMethodAtom, 'importDsl')

    expect(store.get(methodAtom)).toBe('bindApp')
    expect(store.get(effectiveMethodAtom)).toBe('bindApp')
  })

  it('should keep source app loading enabled if stale state points to DSL import', () => {
    const store = createStore()

    store.set(methodAtom, 'importDsl')

    const sourceAppsQuery = store.get(sourceAppsQueryAtom) as unknown as { enabled?: boolean }

    expect(store.get(effectiveMethodAtom)).toBe('bindApp')
    expect(sourceAppsQuery.enabled).toBe(true)
  })

  it('should continue from source app mode and auto-fill unique release metadata', () => {
    const store = createStore()
    mockQueryResults.current.set('sourceApps', {
      data: {
        pages: [
          {
            data: [
              {
                id: 'source-app-1',
                name: 'Customer Service',
                mode: 'workflow',
              },
            ],
          },
        ],
      },
      isSuccess: true,
    })
    mockQueryResults.current.set('precheckRelease', {
      data: {
        canCreate: true,
        unsupportedNodes: [],
      },
      isSuccess: true,
    })
    mockQueryResults.current.set('deploymentOptions', {
      data: {
        options: {
          credentialSlots: [],
          envVarSlots: [],
        },
      },
      isSuccess: true,
    })
    mockQueryResults.current.set('existingInstanceNames', {
      data: {
        pages: [
          {
            appInstances: [
              { displayName: 'Customer Service' },
              { displayName: 'Customer Service 1' },
            ],
          },
        ],
      },
      isSuccess: true,
    })

    expect(store.get(sourceCanGoNextAtom)).toBe(true)

    store.set(continueFromSourceAtom, {
      defaultDslAppName: 'Imported DSL',
      defaultReleaseName: 'Initial Release',
    })

    expect(store.get(selectedAppAtom)).toMatchObject({
      id: 'source-app-1',
      name: 'Customer Service',
    })
    expect(store.get(instanceNameAtom)).toMatch(/^Customer Service-[a-z]{4}$/)
    expect(store.get(releaseNameAtom)).toBe('Initial Release')
    expect(store.get(stepAtom)).toBe('release')
  })

  it('should read selected DSL file content through the file content query', () => {
    const store = createStore()
    const text = vi.fn().mockResolvedValue(workflowDsl())
    const file = new File([], 'workflow.yml', { type: 'text/yaml' })
    Object.defineProperty(file, 'text', { value: text })

    store.set(selectDslFileAtom, file)
    mockQueryResults.current.set('createGuideDslFileContent', {
      data: workflowDsl(),
      isSuccess: true,
    })

    expect(text).not.toHaveBeenCalled()
    expect(store.get(dslFileAtom)).toBe(file)
    expect(store.get(dslDefaultAppNameAtom)).toBe('Imported guide')
    expect(store.get(isReadingDslAtom)).toBe(false)
    expect(store.get(dslReadErrorAtom)).toBe(false)
  })
})
