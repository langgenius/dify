import type { Getter } from 'jotai'
import type { CreateReleaseFormValues } from '../index'
import { QueryClient } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleQuery } from '@/service/client'

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
    atomWithMutation: () => atom(() => mockCreateReleaseMutation.current),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        get: {
          queryOptions: ({ enabled, input }: QueryOptions) => ({
            enabled,
            input,
            queryKey: ['appById', input],
          }),
        },
      },
    },
    enterprise: {
      releaseService: {
        listReleaseSummaries: {
          key: ({ input }: { input?: unknown } = {}) => input === undefined ? ['listReleaseSummaries'] : ['listReleaseSummaries', input],
          queryOptions: ({ enabled, input }: QueryOptions) => ({
            enabled,
            input,
            queryKey: ['listReleaseSummaries', input],
          }),
        },
        listReleases: {
          key: ({ input }: { input?: unknown } = {}) => input === undefined ? ['listReleases'] : ['listReleases', input],
          queryOptions: ({ enabled, input }: QueryOptions) => ({
            enabled,
            input,
            queryKey: ['listReleases', input],
          }),
        },
        precheckRelease: {
          queryOptions: ({ enabled, input }: QueryOptions) => ({
            enabled,
            input,
            queryKey: ['precheckRelease', input],
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
  const unsubscribe = store.sub(state.createReleaseFormValuesAtom, () => undefined)

  return {
    queryClient,
    state,
    store,
    unsubscribe,
  }
}

function sourceApp(overrides: Partial<NonNullable<CreateReleaseFormValues['sourceApp']>> = {}): NonNullable<CreateReleaseFormValues['sourceApp']> {
  return {
    id: 'source-app-1',
    name: 'Source App',
    mode: 'workflow',
    ...overrides,
  }
}

function validationIssueMessage(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error))
    return undefined

  return typeof error.message === 'string' ? error.message : undefined
}

function hasValidationIssue(errors: unknown[], message: string) {
  return errors.some(error => validationIssueMessage(error) === message)
}

function workflowDsl() {
  return [
    'app:',
    '  mode: workflow',
    '  name: Release source',
  ].join('\n')
}

function setDefaultSourceApp(defaultSourceApp = sourceApp({ id: 'default-source-app', name: 'Default Source App' })) {
  mockQueryResults.current.set('listReleases', {
    data: {
      releases: [
        {
          sourceAppId: defaultSourceApp.id,
        },
      ],
    },
    isSuccess: true,
  })
  mockQueryResults.current.set('appById', {
    data: defaultSourceApp,
    isSuccess: true,
  })
}

function setPrecheckReleaseResult(overrides: {
  canCreate?: boolean
  matchedRelease?: unknown
  unsupportedNodes?: Array<{ id?: string, type?: string }>
} = {}) {
  mockQueryResults.current.set('precheckRelease', {
    data: {
      gateCommitId: 'gate-commit-1',
      canCreate: true,
      unsupportedNodes: [],
      ...overrides,
    },
    isSuccess: true,
  })
}

function setCachedReleaseSummaries(queryClient: QueryClient, appInstanceId: string, displayNames: string[]) {
  queryClient.setQueryData(
    consoleQuery.enterprise.releaseService.listReleaseSummaries.key({
      type: 'query',
      input: { params: { appInstanceId } },
    }),
    {
      releaseSummaries: displayNames.map(displayName => ({
        release: {
          displayName,
        },
      })),
      pagination: {},
    },
  )
}

function setDslFileContentResult(overrides: QueryResult = {}) {
  mockQueryResults.current.set('createReleaseDslFileContent', {
    data: workflowDsl(),
    isSuccess: true,
    ...overrides,
  })
}

describe('create release state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.current.clear()
    mockCreateReleaseMutation.current = {
      isPending: false,
      mutateAsync: vi.fn(),
    }
  })

  it('should keep default form values before editing', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    expect(store.get(state.createReleaseFormValuesAtom)).toEqual({
      dslFile: undefined,
      releaseDescription: '',
      releaseName: '',
      releaseSourceMode: 'sourceApp',
      sourceApp: undefined,
    })

    unsubscribe()
  })

  it('should validate release name only when submitting', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    await store.set(state.submitCreateReleaseFormAtom)

    expect(mockCreateReleaseMutation.current.mutateAsync).not.toHaveBeenCalled()
    expect(hasValidationIssue(
      store.get(state.createReleaseNameFieldAtom).meta?.errors ?? [],
      state.RELEASE_NAME_REQUIRED_ERROR,
    )).toBe(true)

    unsubscribe()
  })

  it('should submit after fixing release name following a submit validation error', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const response = {
      release: {
        displayName: 'Release 1',
      },
    }
    mockCreateReleaseMutation.current.mutateAsync.mockResolvedValue(response)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()

    await store.set(state.submitCreateReleaseFormAtom)
    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBe(response)
    expect(mockCreateReleaseMutation.current.mutateAsync).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('should coerce DSL source mode to source app mode when DSL import is disabled', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    store.set(state.selectCreateReleaseSourceModeAtom, 'dsl')

    expect(store.get(state.createReleaseSourceModeFieldAtom).value).toBe('sourceApp')
    expect(store.get(state.createReleaseSourceModeAtom)).toBe('sourceApp')

    unsubscribe()
  })

  it('should derive default source app selection from the latest release source', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()

    expect(store.get(state.createReleaseSelectedSourceAppAtom)).toEqual({
      id: 'default-source-app',
      name: 'Default Source App',
      mode: 'workflow',
    })
    expect(store.get(state.createReleaseSelectedSourceAppAtom)?.id).toBe('default-source-app')

    unsubscribe()
  })

  it('should derive workflow DSL read state when selecting a DSL file', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })

    store.set(state.updateCreateReleaseDslFileAtom, file)
    setDslFileContentResult()

    expect(store.get(state.createReleaseDslFileFieldAtom).value).toBe(file)
    expect(store.get(state.createReleaseDslContentAtom)).toBe(workflowDsl())
    expect(store.get(state.createReleaseHasDslContentAtom)).toBe(true)
    expect(store.get(state.isReadingCreateReleaseDslAtom)).toBe(false)
    expect(store.get(state.createReleaseIsWorkflowDslContentAtom)).toBe(true)
    expect(store.get(state.createReleaseEncodedDslContentAtom)).not.toBe('')

    unsubscribe()
  })

  it('should reset DSL state when switching back to source app mode', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })

    store.set(state.updateCreateReleaseDslFileAtom, file)
    setDslFileContentResult()
    store.set(state.selectCreateReleaseSourceModeAtom, 'sourceApp')

    expect(store.get(state.createReleaseSourceModeFieldAtom).value).toBe('sourceApp')
    expect(store.get(state.createReleaseDslFileFieldAtom).value).toBeUndefined()
    expect(store.get(state.createReleaseDslContentAtom)).toBe('')
    expect(store.get(state.createReleaseDslReadErrorAtom)).toBe(false)
    expect(store.get(state.createReleaseEncodedDslContentAtom)).toBe('')
    expect(store.get(state.createReleaseHasDslContentAtom)).toBe(false)
    expect(store.get(state.isReadingCreateReleaseDslAtom)).toBe(false)
    expect(store.get(state.createReleaseIsWorkflowDslContentAtom)).toBe(false)

    unsubscribe()
  })

  it('should capture DSL file read failures and clear them when opening or closing the dialog', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const file = new File(['broken'], 'broken.yml', { type: 'text/yaml' })

    store.set(state.updateCreateReleaseDslFileAtom, file)
    setDslFileContentResult({
      data: undefined,
      isError: true,
      isSuccess: false,
    })

    expect(store.get(state.createReleaseDslReadErrorAtom)).toBe(true)

    store.set(state.openCreateReleaseDialogAtom)
    expect(store.get(state.createReleaseDialogOpenAtom)).toBe(true)
    expect(store.get(state.createReleaseDslReadErrorAtom)).toBe(false)

    store.set(state.closeCreateReleaseDialogAtom)
    expect(store.get(state.createReleaseDialogOpenAtom)).toBe(false)

    unsubscribe()
  })

  it('should derive content readiness from release content precheck', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()

    expect(store.get(state.createReleaseContentReadyAtom)).toBe(true)

    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    expect(store.get(state.createReleaseContentReadyAtom)).toBe(true)

    unsubscribe()
  })

  it('should detect existing release name conflicts from cached release summaries', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    store.set(state.createReleaseNameFieldAtom, ' Release 1 ')
    setCachedReleaseSummaries(queryClient, 'app-instance-1', ['Release 1'])

    expect(store.get(state.createReleaseHasNameConflictAtom)).toBe(true)

    unsubscribe()
  })

  it('should close the dialog through the close request action', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    store.set(state.openCreateReleaseDialogAtom)
    store.set(state.requestCloseCreateReleaseDialogAtom)

    expect(store.get(state.createReleaseDialogOpenAtom)).toBe(false)

    unsubscribe()
  })

  it('should expose unsupported nodes from release content precheck', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult({
      canCreate: false,
      unsupportedNodes: [{ id: 'precheck-node' }],
    })

    expect(store.get(state.createReleaseUnsupportedDslNodesAtom)).toEqual([{ id: 'precheck-node' }])

    unsubscribe()
  })

  it('should submit source app release with the checked source and metadata', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const response = {
      release: {
        displayName: 'Release 1',
      },
    }
    mockCreateReleaseMutation.current.mutateAsync.mockResolvedValue(response)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()
    store.set(state.createReleaseNameFieldAtom, ' Release 1 ')
    store.set(state.createReleaseDescriptionFieldAtom, ' Initial rollout ')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBe(response)
    expect(mockCreateReleaseMutation.current.mutateAsync).toHaveBeenCalledWith({
      body: {
        appInstanceId: 'app-instance-1',
        sourceAppId: 'default-source-app',
        displayName: 'Release 1',
        description: 'Initial rollout',
        createAppInstance: false,
      },
    })

    unsubscribe()
  })

  it('should block release submission when release name already exists', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()
    setCachedReleaseSummaries(queryClient, 'app-instance-1', ['Release 1'])
    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBeUndefined()
    expect(mockCreateReleaseMutation.current.mutateAsync).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('should propagate create release submission errors', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const submitError = new Error('submit failed')
    mockCreateReleaseMutation.current.mutateAsync.mockRejectedValue(submitError)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()
    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    await expect(store.set(state.submitCreateReleaseFormAtom)).rejects.toThrow(submitError)

    unsubscribe()
  })
})
