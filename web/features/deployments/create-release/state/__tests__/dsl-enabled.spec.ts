import type { QueryClient } from '@tanstack/react-query'
import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
}

type InfiniteQueryOptions = QueryOptions & {
  input?: (pageParam: number) => unknown
}

const mockSourceAppsInfiniteOptions = vi.hoisted(() => vi.fn())
const mockPrecheckReleaseQueryOptions = vi.hoisted(() => vi.fn())
const mockCreateRelease = vi.hoisted(() => vi.fn())

vi.mock('../../../shared/domain/feature-flags', () => ({
  isDeploymentDslImportEnabled: true,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      get: {
        infiniteOptions: (options: InfiniteQueryOptions) => {
          mockSourceAppsInfiniteOptions(options)

          return {
            ...options,
            queryKey: ['sourceApps', options.input],
            queryFn: async () => ({
              data: [],
              has_more: false,
              limit: 20,
              page: 1,
              total: 0,
            }),
          }
        },
      },
    },
    enterprise: {
      releaseService: {
        listReleaseSummaries: {
          key: ({ input }: { input?: unknown } = {}) =>
            input === undefined ? ['listReleaseSummaries'] : ['listReleaseSummaries', input],
        },
        listReleases: {
          key: ({ input }: { input?: unknown } = {}) =>
            input === undefined ? ['listReleases'] : ['listReleases', input],
        },
        precheckRelease: {
          queryOptions: (options: QueryOptions) => {
            mockPrecheckReleaseQueryOptions(options)

            return {
              ...options,
              queryKey: ['precheckRelease', options.input],
            }
          },
        },
        createRelease: {
          mutationOptions: () => ({
            mutationKey: ['createRelease'],
            mutationFn: mockCreateRelease,
          }),
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
  const { queryClient, store } = createQueryAtomTestStore()
  const unsubscribe = store.sub(state.createReleaseFormIsSubmittingAtom, () => undefined)

  return {
    queryClient,
    state,
    store,
    unsubscribe,
  }
}

function workflowDsl() {
  return ['app:', '  mode: workflow', '  name: Release source'].join('\n')
}

function setDslFileContentResult(queryClient: QueryClient, file: File, fileReadVersion: number) {
  queryClient.setQueryData(
    ['createReleaseDslFileContent', fileReadVersion, file, file.name, file.size, file.lastModified],
    workflowDsl(),
  )
}

function setPrecheckReleaseResult(
  queryClient: QueryClient,
  input: {
    body: {
      appInstanceId: string
      dsl: string
    }
  },
) {
  queryClient.setQueryData(['precheckRelease', input], {
    gateCommitId: 'gate-commit-1',
    canCreate: true,
    unsupportedNodes: [],
  })
}

describe('create release state with DSL import enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateRelease.mockReset()
  })

  it('should enable source app search with the current search text while creating from an app', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    store.set(state.createReleaseSourceAppSearchTextAtom, 'customer')

    store.get(state.createReleaseSourceAppsQueryAtom)
    const sourceAppsQuery = mockSourceAppsInfiniteOptions.mock.lastCall?.[0] as InfiniteQueryOptions

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

  it('should skip DSL release precheck input until DSL content is ready', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    store.set(state.selectCreateReleaseSourceModeAtom, 'dsl')
    store.get(state.isCheckingCreateReleaseContentAtom)

    expect(mockPrecheckReleaseQueryOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: false,
        input: skipToken,
      }),
    )

    unsubscribe()
  })

  it('should submit a DSL release with encoded workflow content', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    const response = {
      release: {
        displayName: 'Release from DSL',
      },
    }
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })
    mockCreateRelease.mockResolvedValue(response)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    store.set(state.selectCreateReleaseSourceModeAtom, 'dsl')
    store.set(state.updateCreateReleaseDslFileAtom, file)
    setDslFileContentResult(queryClient, file, 2)
    const encodedDslContent = store.get(state.createReleaseEncodedDslContentAtom)
    setPrecheckReleaseResult(queryClient, {
      body: {
        appInstanceId: 'app-instance-1',
        dsl: encodedDslContent,
      },
    })
    store.set(state.createReleaseNameFieldAtom, ' Release from DSL ')
    store.set(state.createReleaseDescriptionFieldAtom, ' Imported workflow ')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBe(response)
    expect(encodedDslContent).not.toBe('')
    expect(mockCreateRelease.mock.calls[0]?.[0]).toEqual({
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
