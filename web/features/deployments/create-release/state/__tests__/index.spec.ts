import type { Getter } from 'jotai'
import type { CreateReleaseFormValues } from '../index'
import { atom, createStore } from 'jotai'
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
  queryKey?: readonly unknown[]
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
      const queryResult = mockQueryResults.current.get(queryName)

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
        listReleases: {
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
  const unsubscribe = store.sub(state.createReleaseFormValuesAtom, () => undefined)

  return {
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

function unsupportedDslNodeResponse() {
  return new Response(JSON.stringify({
    reason: 'APPDEPLOY_UNSUPPORTED_DSL_NODE_TYPE',
    metadata: {
      unsupported_nodes: [
        { id: 'node-1' },
      ],
    },
  }), {
    status: 400,
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

  it('should coerce DSL source mode to source app mode when DSL import is disabled', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    store.set(state.selectCreateReleaseSourceModeAtom, 'dsl')

    expect(store.get(state.createReleaseSourceModeFieldAtom).value).toBe('sourceApp')
    expect(store.get(state.createReleaseSourceModeAtom)).toBe('sourceApp')

    unsubscribe()
  })

  it('should derive default source app selection from the latest release source', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseConfigAtom, { appInstanceId: 'app-instance-1' })
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

    await store.set(state.updateCreateReleaseDslFileAtom, file)

    const dslState = store.get(state.createReleaseDslStateAtom)
    expect(store.get(state.createReleaseDslFileFieldAtom).value).toBe(file)
    expect(dslState.dslContent).toBe(workflowDsl())
    expect(dslState.hasDslContent).toBe(true)
    expect(dslState.isReadingDsl).toBe(false)
    expect(dslState.isWorkflowDslContent).toBe(true)
    expect(dslState.encodedDslContent).not.toBe('')

    unsubscribe()
  })

  it('should reset DSL state when switching back to source app mode', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })

    await store.set(state.updateCreateReleaseDslFileAtom, file)
    store.set(state.selectCreateReleaseSourceModeAtom, 'sourceApp')

    expect(store.get(state.createReleaseSourceModeFieldAtom).value).toBe('sourceApp')
    expect(store.get(state.createReleaseDslFileFieldAtom).value).toBeUndefined()
    expect(store.get(state.createReleaseDslStateAtom)).toEqual({
      dslContent: '',
      dslReadError: false,
      encodedDslContent: '',
      hasDslContent: false,
      isReadingDsl: false,
      isWorkflowDslContent: false,
    })

    unsubscribe()
  })

  it('should capture DSL file read failures and clear them when opening or closing the dialog', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const file = new File(['broken'], 'broken.yml', { type: 'text/yaml' })
    const readError = new Error('read failed')
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn().mockRejectedValue(readError),
    })

    await store.set(state.updateCreateReleaseDslFileAtom, file)

    expect(store.get(state.createReleaseDslStateAtom).dslReadError).toBe(true)
    expect(store.get(state.createReleaseSubmitUnsupportedDslNodesAtom)).toEqual([])

    store.set(state.createReleaseSubmitUnsupportedDslNodesAtom, [{ id: 'node-1' }])
    store.set(state.openCreateReleaseDialogAtom)
    expect(store.get(state.createReleaseDialogOpenAtom)).toBe(true)
    expect(store.get(state.createReleaseDslStateAtom).dslReadError).toBe(false)
    expect(store.get(state.createReleaseSubmitUnsupportedDslNodesAtom)).toEqual([])

    store.set(state.createReleaseSubmitUnsupportedDslNodesAtom, [{ type: 'unsupported' }])
    store.set(state.closeCreateReleaseDialogAtom)
    expect(store.get(state.createReleaseDialogOpenAtom)).toBe(false)
    expect(store.get(state.createReleaseSubmitUnsupportedDslNodesAtom)).toEqual([])

    unsubscribe()
  })

  it('should derive create readiness from release name and content precheck', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseConfigAtom, { appInstanceId: 'app-instance-1' })
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()

    expect(store.get(state.createReleaseContentCheckAtom).releaseContentReady).toBe(true)
    expect(store.get(state.createReleaseCanCreateAtom)).toBe(false)

    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    expect(store.get(state.createReleaseCanCreateAtom)).toBe(true)

    unsubscribe()
  })

  it('should prefer precheck unsupported nodes over submit fallback nodes', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseConfigAtom, { appInstanceId: 'app-instance-1' })
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult({
      canCreate: false,
      unsupportedNodes: [{ id: 'precheck-node' }],
    })
    store.set(state.createReleaseSubmitUnsupportedDslNodesAtom, [{ id: 'submit-node' }])

    expect(store.get(state.createReleaseUnsupportedDslNodesAtom)).toEqual([{ id: 'precheck-node' }])

    unsubscribe()
  })

  it('should use submit fallback nodes when precheck has no unsupported nodes', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseConfigAtom, { appInstanceId: 'app-instance-1' })
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()
    store.set(state.createReleaseSubmitUnsupportedDslNodesAtom, [{ id: 'submit-node' }])

    expect(store.get(state.createReleaseUnsupportedDslNodesAtom)).toEqual([{ id: 'submit-node' }])

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
    store.set(state.createReleaseConfigAtom, { appInstanceId: 'app-instance-1' })
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

  it('should capture unsupported DSL nodes returned by create release submission', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    mockCreateReleaseMutation.current.mutateAsync.mockRejectedValue(unsupportedDslNodeResponse())
    store.set(state.createReleaseConfigAtom, { appInstanceId: 'app-instance-1' })
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp()
    setPrecheckReleaseResult()
    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBeUndefined()
    expect(store.get(state.createReleaseSubmitUnsupportedDslNodesAtom)).toEqual([{ id: 'node-1' }])

    unsubscribe()
  })
})
