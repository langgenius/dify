import type { QueryClient } from '@tanstack/react-query'
import type { CreateReleaseFormValues } from '../index'
import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleQuery } from '@/service/client'
import { createQueryAtomTestStore } from '@/test/query-atom'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
}

const mockPrecheckReleaseQueryOptions = vi.hoisted(() => vi.fn())
const mockCreateRelease = vi.hoisted(() => vi.fn())

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
          key: ({ input }: { input?: unknown } = {}) =>
            input === undefined ? ['listReleaseSummaries'] : ['listReleaseSummaries', input],
          queryOptions: ({ enabled, input }: QueryOptions) => ({
            enabled,
            input,
            queryKey: ['listReleaseSummaries', input],
          }),
        },
        listReleases: {
          key: ({ input }: { input?: unknown } = {}) =>
            input === undefined ? ['listReleases'] : ['listReleases', input],
          queryOptions: ({ enabled, input }: QueryOptions) => ({
            enabled,
            input,
            queryKey: ['listReleases', input],
          }),
        },
        precheckRelease: {
          queryOptions: ({ enabled, input }: QueryOptions) => {
            mockPrecheckReleaseQueryOptions({ enabled, input })

            return {
              enabled,
              input,
              queryKey: ['precheckRelease', input],
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

function sourceApp(
  overrides: Partial<NonNullable<CreateReleaseFormValues['sourceApp']>> = {},
): NonNullable<CreateReleaseFormValues['sourceApp']> {
  return {
    id: 'source-app-1',
    name: 'Source App',
    mode: 'workflow',
    ...overrides,
  }
}

function validationIssueMessage(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined

  return typeof error.message === 'string' ? error.message : undefined
}

function hasValidationIssue(errors: unknown[], message: string) {
  return errors.some((error) => validationIssueMessage(error) === message)
}

function workflowDsl() {
  return ['app:', '  mode: workflow', '  name: Release source'].join('\n')
}

function setDefaultSourceApp(
  queryClient: QueryClient,
  appInstanceId: string,
  defaultSourceApp = sourceApp({ id: 'default-source-app', name: 'Default Source App' }),
) {
  queryClient.setQueryData(
    [
      'listReleases',
      {
        params: { appInstanceId },
        query: {
          pageNumber: 1,
          resultsPerPage: 1,
        },
      },
    ],
    {
      releases: [
        {
          displayName: 'Previous Release',
          sourceAppId: defaultSourceApp.id,
        },
      ],
    },
  )
  queryClient.setQueryData(
    ['appById', { params: { app_id: defaultSourceApp.id } }],
    defaultSourceApp,
  )
}

function setPrecheckReleaseResult(
  queryClient: QueryClient,
  input: {
    body: {
      appInstanceId: string
      dsl?: string
      sourceAppId?: string
    }
  },
  overrides: {
    canCreate?: boolean
    matchedRelease?: unknown
    unsupportedNodes?: Array<{ id?: string; type?: string }>
  } = {},
) {
  queryClient.setQueryData(['precheckRelease', input], {
    gateCommitId: 'gate-commit-1',
    canCreate: true,
    unsupportedNodes: [],
    ...overrides,
  })
}

function setCachedReleaseSummaries(
  queryClient: QueryClient,
  appInstanceId: string,
  displayNames: string[],
) {
  queryClient.setQueryData(
    consoleQuery.enterprise.releaseService.listReleaseSummaries.key({
      type: 'query',
      input: { params: { appInstanceId } },
    }),
    {
      releaseSummaries: displayNames.map((displayName) => ({
        release: {
          displayName,
        },
      })),
      pagination: {},
    },
  )
}

function setDslFileContentResult(queryClient: QueryClient, file: File, fileReadVersion: number) {
  queryClient.setQueryData(
    ['createReleaseDslFileContent', fileReadVersion, file, file.name, file.size, file.lastModified],
    workflowDsl(),
  )
}

describe('create release state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateRelease.mockReset()
  })

  it('should validate release name only when submitting', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    await store.set(state.submitCreateReleaseFormAtom)

    expect(mockCreateRelease).not.toHaveBeenCalled()
    expect(
      hasValidationIssue(
        store.get(state.createReleaseNameFieldAtom).meta?.errors ?? [],
        state.RELEASE_NAME_REQUIRED_ERROR,
      ),
    ).toBe(true)

    unsubscribe()
  })

  it('should submit after fixing release name following a submit validation error', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    const response = {
      release: {
        displayName: 'Release 1',
      },
    }
    mockCreateRelease.mockResolvedValue(response)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp(queryClient, 'app-instance-1')
    setPrecheckReleaseResult(queryClient, {
      body: {
        appInstanceId: 'app-instance-1',
        sourceAppId: 'default-source-app',
      },
    })

    await store.set(state.submitCreateReleaseFormAtom)
    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBe(response)
    expect(mockCreateRelease).toHaveBeenCalledTimes(1)

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
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp(queryClient, 'app-instance-1')

    expect(store.get(state.createReleaseSelectedSourceAppAtom)).toEqual({
      id: 'default-source-app',
      name: 'Default Source App',
      mode: 'workflow',
    })
    expect(store.get(state.createReleaseSelectedSourceAppAtom)?.id).toBe('default-source-app')

    unsubscribe()
  })

  it('should derive workflow DSL read state when selecting a DSL file', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })

    store.set(state.updateCreateReleaseDslFileAtom, file)
    setDslFileContentResult(queryClient, file, 1)

    expect(store.get(state.createReleaseDslFileFieldAtom).value).toBe(file)
    expect(store.get(state.createReleaseDslContentAtom)).toBe(workflowDsl())
    expect(store.get(state.createReleaseHasDslContentAtom)).toBe(true)
    expect(store.get(state.isReadingCreateReleaseDslAtom)).toBe(false)
    expect(store.get(state.createReleaseIsWorkflowDslContentAtom)).toBe(true)
    expect(store.get(state.createReleaseEncodedDslContentAtom)).not.toBe('')

    unsubscribe()
  })

  it('should reset DSL state when switching back to source app mode', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })

    store.set(state.updateCreateReleaseDslFileAtom, file)
    setDslFileContentResult(queryClient, file, 1)
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

  it('should reset source app search text when opening or closing the dialog', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    store.set(state.createReleaseSourceAppSearchTextAtom, 'customer')
    store.set(state.openCreateReleaseDialogAtom)

    expect(store.get(state.createReleaseSourceAppSearchTextAtom)).toBe('')

    store.set(state.createReleaseSourceAppSearchTextAtom, 'support')
    store.set(state.closeCreateReleaseDialogAtom)

    expect(store.get(state.createReleaseSourceAppSearchTextAtom)).toBe('')

    unsubscribe()
  })

  it('should skip release content precheck input until source content is ready', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    store.get(state.isCheckingCreateReleaseContentAtom)

    expect(mockPrecheckReleaseQueryOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: false,
        input: skipToken,
      }),
    )

    unsubscribe()
  })

  it('should capture DSL file read failures and clear them when opening or closing the dialog', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const file = new File(['broken'], 'broken.yml', { type: 'text/yaml' })
    vi.spyOn(file, 'text').mockRejectedValue(new Error('read failed'))

    store.set(state.updateCreateReleaseDslFileAtom, file)
    const unsubscribeDslReadError = store.sub(state.createReleaseDslReadErrorAtom, () => undefined)

    await vi.waitFor(() => {
      expect(store.get(state.createReleaseDslReadErrorAtom)).toBe(true)
    })

    store.set(state.openCreateReleaseDialogAtom)
    expect(store.get(state.createReleaseDialogOpenAtom)).toBe(true)
    expect(store.get(state.createReleaseDslReadErrorAtom)).toBe(false)

    store.set(state.closeCreateReleaseDialogAtom)
    expect(store.get(state.createReleaseDialogOpenAtom)).toBe(false)

    unsubscribeDslReadError()
    unsubscribe()
  })

  it('should derive content readiness from release content precheck', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp(queryClient, 'app-instance-1')
    setPrecheckReleaseResult(queryClient, {
      body: {
        appInstanceId: 'app-instance-1',
        sourceAppId: 'default-source-app',
      },
    })

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
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp(queryClient, 'app-instance-1')
    setPrecheckReleaseResult(
      queryClient,
      {
        body: {
          appInstanceId: 'app-instance-1',
          sourceAppId: 'default-source-app',
        },
      },
      {
        canCreate: false,
        unsupportedNodes: [{ id: 'precheck-node' }],
      },
    )

    expect(store.get(state.createReleaseUnsupportedDslNodesAtom)).toEqual([{ id: 'precheck-node' }])

    unsubscribe()
  })

  it('should submit source app release with the checked source and metadata', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    const response = {
      release: {
        displayName: 'Release 1',
      },
    }
    mockCreateRelease.mockResolvedValue(response)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp(queryClient, 'app-instance-1')
    setPrecheckReleaseResult(queryClient, {
      body: {
        appInstanceId: 'app-instance-1',
        sourceAppId: 'default-source-app',
      },
    })
    store.set(state.createReleaseNameFieldAtom, ' Release 1 ')
    store.set(state.createReleaseDescriptionFieldAtom, ' Initial rollout ')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBe(response)
    expect(mockCreateRelease.mock.calls[0]?.[0]).toEqual({
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
    setDefaultSourceApp(queryClient, 'app-instance-1')
    setPrecheckReleaseResult(queryClient, {
      body: {
        appInstanceId: 'app-instance-1',
        sourceAppId: 'default-source-app',
      },
    })
    setCachedReleaseSummaries(queryClient, 'app-instance-1', ['Release 1'])
    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    const result = await store.set(state.submitCreateReleaseFormAtom)

    expect(result).toBeUndefined()
    expect(mockCreateRelease).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('should propagate create release submission errors', async () => {
    const { queryClient, state, store, unsubscribe } = await mountedStore()
    const submitError = new Error('submit failed')
    mockCreateRelease.mockRejectedValue(submitError)
    store.set(state.createReleaseAppInstanceIdAtom, 'app-instance-1')
    store.set(state.openCreateReleaseDialogAtom)
    setDefaultSourceApp(queryClient, 'app-instance-1')
    setPrecheckReleaseResult(queryClient, {
      body: {
        appInstanceId: 'app-instance-1',
        sourceAppId: 'default-source-app',
      },
    })
    store.set(state.createReleaseNameFieldAtom, 'Release 1')

    await expect(store.set(state.submitCreateReleaseFormAtom)).rejects.toThrow(submitError)

    unsubscribe()
  })
})
