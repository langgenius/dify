import type {
  AppDetailWithSite,
  WorkflowResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'
import type { Shape } from '@/app/components/workflow/store/workflow'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createHttpError } from '@/service/http-error'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { seedAppDetail } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { AppACLPermission } from '@/utils/permission'
import { useWorkflowInit } from '../use-workflow-init'

const mockFetchNodesDefaultConfigs = vi.fn()
const mockFetchPublishedWorkflow = vi.fn()
const mockSyncWorkflowDraft = vi.fn()

let appDetail: AppDetailWithSite

const renderHook = <Result>(
  callback: () => Result,
  initialStoreState?: Partial<Shape>,
  queryClient = createAccountProfileQueryClient({ id: 'user-1' }),
) => {
  seedAppDetail(queryClient, appDetail)
  return renderWorkflowHook(callback, {
    resource: {
      kind: 'app',
      appId: 'app-1',
      mode: appDetail.mode === 'advanced-chat' ? 'advanced-chat' : 'workflow',
    },
    queryClient,
    initialStoreState,
  })
}

let workflowConfigState: {
  data: UploadConfig | null
  isLoading: boolean
}

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})

vi.mock('../use-workflow-template', () => ({
  useWorkflowTemplate: () => ({
    nodes:
      appDetail.mode === 'workflow'
        ? [{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }]
        : [{ id: 'start', data: { type: BlockEnum.Start } }],
    edges: [],
  }),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: async (url: string) => {
    if (url === '/files/upload') return workflowConfigState.data ?? createFileUploadConfigFixture()
    throw new Error(`Unexpected GET ${url}`)
  },
}))

vi.mock('@/service/workflow-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/workflow-queries')>()
  return {
    ...actual,
    appWorkflowQueryOptions: (appId: string) => ({
      ...actual.appWorkflowQueryOptions(appId),
      queryFn: () => mockFetchPublishedWorkflow(`/apps/${appId}/workflows/publish`),
    }),
  }
})

const mockFetchWorkflowDraft = vi.fn()

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
  syncWorkflowDraft: (...args: unknown[]) => mockSyncWorkflowDraft(...args),
  fetchNodesDefaultConfigs: (...args: unknown[]) => mockFetchNodesDefaultConfigs(...args),
}))

const notExistError = () =>
  createHttpError(new Response(null, { status: 404 }), {
    code: 'draft_workflow_not_exist',
    message: 'Draft workflow not exist.',
    status: 404,
  })

const draftResponse = {
  id: 'draft-id',
  graph: {
    nodes: [{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }],
    edges: [],
  },
  hash: 'server-hash',
  created_at: 0,
  created_by: { id: '', name: '', email: '' },
  updated_at: 1,
  updated_by: { id: '', name: '', email: '' },
  tool_published: false,
  features: { retriever_resource: { enabled: true } },
  environment_variables: [],
  conversation_variables: [],
  version: '1',
  marked_name: '',
  marked_comment: '',
}

describe('useWorkflowInit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    appDetail = createAppDetailFixture({
      id: 'app-1',
      name: 'Test',
      mode: 'workflow',
      permission_keys: [AppACLPermission.Edit],
    })
    workflowConfigState = { data: null, isLoading: false }
    mockFetchNodesDefaultConfigs.mockResolvedValue([])
    mockFetchPublishedWorkflow.mockResolvedValue({ created_at: 0, graph: { nodes: [], edges: [] } })
    mockFetchWorkflowDraft.mockRejectedValueOnce(notExistError())
    mockSyncWorkflowDraft.mockReset()
  })

  it.each([undefined, { x: 120, y: -80, zoom: 0.75 }])(
    'should preserve the initial draft viewport as %j',
    async (viewport) => {
      mockFetchWorkflowDraft.mockReset().mockResolvedValue({
        ...draftResponse,
        graph: { ...draftResponse.graph, viewport },
      })

      const { result } = renderHook(() => useWorkflowInit())

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(result.current.data?.graph.viewport).toEqual(viewport)
    },
  )

  it('should create an empty backend draft and restore a local start placeholder when the workflow draft does not exist', async () => {
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())
      .mockResolvedValueOnce({
        ...draftResponse,
        graph: { nodes: [], edges: [] },
        hash: 'new-workflow-hash',
      })
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1 })

    const { result, store } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
      ])
    })

    expect(store.getState()).toMatchObject({
      showOnboarding: false,
      shouldAutoOpenStartNodeSelector: false,
      hasSelectedStartNode: false,
      hasShownOnboarding: true,
    })
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          graph: {
            nodes: [],
            edges: [],
          },
          force: true,
        }),
      }),
    )
    expect(store.getState().syncWorkflowDraftHash).toBe('new-workflow-hash')
  })

  it('should keep creating the first backend draft for advanced chat apps', async () => {
    appDetail = createAppDetailFixture({
      id: 'app-1',
      name: 'Test',
      mode: 'advanced-chat',
      permission_keys: [AppACLPermission.Edit],
    })
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())
      .mockResolvedValueOnce(draftResponse)
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1 })

    const { result, store } = renderHook(() => useWorkflowInit())

    await waitFor(() =>
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: {
              nodes: [{ id: 'start', data: { type: BlockEnum.Start } }],
              edges: [],
            },
            force: true,
          }),
        }),
      ),
    )
    await waitFor(() => expect(result.current.data?.hash).toBe('server-hash'))
    expect(store.getState()).toMatchObject({
      showOnboarding: false,
      shouldAutoOpenStartNodeSelector: false,
      hasShownOnboarding: false,
      syncWorkflowDraftHash: 'server-hash',
    })
  })

  it('should keep readonly users local when the first workflow draft does not exist', async () => {
    appDetail = createAppDetailFixture({
      id: 'app-1',
      name: 'Test',
      mode: 'workflow',
      permission_keys: [AppACLPermission.ViewLayout],
    })
    mockFetchWorkflowDraft.mockReset().mockRejectedValueOnce(notExistError())

    const { result, store } = renderHook(() => useWorkflowInit(), {
      syncWorkflowDraftHash: 'stale-hash',
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.graph.nodes).toEqual([
      { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
    ])
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(store.getState()).toMatchObject({
      envSecrets: {},
      environmentVariables: [],
      conversationVariables: [],
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: '',
    })
    expect(result.current.data?.graph.viewport).toBeUndefined()
  })

  it('should restore a local start placeholder when an existing workflow draft has an empty graph', async () => {
    mockFetchWorkflowDraft.mockReset().mockResolvedValue({
      ...draftResponse,
      graph: { nodes: [], edges: [] },
      hash: 'empty-draft-hash',
    })

    const { result, store } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
      ])
    })

    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(store.getState().syncWorkflowDraftHash).toBe('empty-draft-hash')
  })

  it('should preserve existing draft nodes when restoring the local start placeholder', async () => {
    const existingNode = { id: 'llm', data: { type: BlockEnum.LLM } }
    const existingEdge = { source: 'llm', target: 'answer' }
    mockFetchWorkflowDraft.mockReset().mockResolvedValue({
      ...draftResponse,
      graph: {
        nodes: [existingNode],
        edges: [existingEdge],
      },
    })

    const { result } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
        existingNode,
      ])
    })

    expect(result.current.data?.graph.edges).toEqual([existingEdge])
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should hydrate draft state, preload defaults, and derive published workflow metadata on success', async () => {
    workflowConfigState = {
      data: createFileUploadConfigFixture({ file_size_limit: 20 }),
      isLoading: false,
    }
    mockFetchWorkflowDraft.mockReset().mockResolvedValue({
      ...draftResponse,
      updated_at: 9,
      tool_published: true,
      environment_variables: [
        { id: 'env-secret', value_type: 'secret', value: 'top-secret', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ],
      conversation_variables: [{ id: 'conversation-1' }],
    })
    mockFetchNodesDefaultConfigs.mockResolvedValue([
      { type: 'start', config: { title: 'Start Config' } },
      { type: 'start', config: { title: 'Ignored Duplicate' } },
    ])
    mockFetchPublishedWorkflow.mockResolvedValue({
      created_at: 99,
      graph: {
        nodes: [{ id: 'start', data: { type: BlockEnum.Start } }],
        edges: [{ source: 'start', target: 'end' }],
      },
    })

    const { result, store } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.hash).toBe('server-hash')
    })
    await waitFor(() => expect(store.getState().publishedAt).toBe(99_000))

    expect(store.getState()).toMatchObject({
      envSecrets: { 'env-secret': 'top-secret' },
      environmentVariables: [
        { id: 'env-secret', value_type: 'secret', value: '[__HIDDEN__]', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ],
      conversationVariables: [{ id: 'conversation-1' }],
      isWorkflowDataLoaded: true,
      nodesDefaultConfigs: { start: { title: 'Start Config' } },
      syncWorkflowDraftHash: 'server-hash',
      draftUpdatedAt: 9000,
      toolPublished: true,
      lastPublishedHasUserInput: true,
      fileUploadConfig: createFileUploadConfigFixture({ file_size_limit: 20 }),
    })
    expect(result.current.fileUploadConfigResponse).toEqual(
      createFileUploadConfigFixture({ file_size_limit: 20 }),
    )
    expect(result.current.isLoading).toBe(false)
  })

  it('should keep published metadata when loading node defaults fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    mockFetchNodesDefaultConfigs.mockRejectedValue(new Error('preload failed'))
    mockFetchPublishedWorkflow.mockResolvedValue({
      created_at: 99,
      graph: {
        nodes: [{ id: 'start', data: { type: BlockEnum.Start } }],
        edges: [{ source: 'start', target: 'end' }],
      },
    })

    const { store } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(store.getState()).toMatchObject({
        publishedAt: 99_000,
        lastPublishedHasUserInput: true,
      })
    })

    consoleErrorSpy.mockRestore()
  })

  it('should keep node defaults when loading published metadata fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const publishedError = new Error('published workflow failed')
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    mockFetchNodesDefaultConfigs.mockResolvedValue([
      { type: 'start', config: { title: 'Start Config' } },
    ])
    mockFetchPublishedWorkflow.mockRejectedValue(publishedError)

    const { store } = renderHook(() => useWorkflowInit(), { lastPublishedHasUserInput: true })

    await waitFor(() => {
      expect(store.getState()).toMatchObject({
        nodesDefaultConfigs: { start: { title: 'Start Config' } },
        lastPublishedHasUserInput: false,
      })
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(publishedError)
    consoleErrorSpy.mockRestore()
  })

  it('uses the newer published result when a canceled preload settles after publication', async () => {
    const defaults = createDeferred<[]>()
    const oldPublished = createDeferred<null>()
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    mockFetchNodesDefaultConfigs.mockReturnValue(defaults.promise)
    mockFetchPublishedWorkflow.mockReturnValueOnce(oldPublished.promise).mockResolvedValueOnce({
      created_at: 99,
      graph: {
        nodes: [{ id: 'start', data: { type: BlockEnum.Start } }],
        edges: [{ source: 'start', target: 'end' }],
      },
    })
    const queryClient = createAccountProfileQueryClient({ id: 'user-1' })
    const publishedQuery = appWorkflowQueryOptions('app-1')
    const { store } = renderHook(() => useWorkflowInit(), undefined, queryClient)
    await waitFor(() => expect(mockFetchPublishedWorkflow).toHaveBeenCalledOnce())
    await act(async () => {
      await queryClient.cancelQueries({ queryKey: publishedQuery.queryKey, exact: true })
      await queryClient.query({ ...publishedQuery, staleTime: 0 })
      oldPublished.resolve(null)
      defaults.resolve([])
    })
    await waitFor(() => expect(store.getState().publishedAt).toBe(99_000))
    expect(store.getState().lastPublishedHasUserInput).toBe(true)
  })

  it('preserves native publication when a stale cached null survives failed preload', async () => {
    const defaults = createDeferred<[]>()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    mockFetchNodesDefaultConfigs.mockReturnValue(defaults.promise)
    mockFetchPublishedWorkflow.mockRejectedValue(new Error('published GET failed'))
    const queryClient = createAccountProfileQueryClient({ id: 'user-1' })
    const publishedQuery = appWorkflowQueryOptions('app-1')
    queryClient.setQueryData<WorkflowResponse | null>(publishedQuery.queryKey, null)
    await queryClient.invalidateQueries({
      queryKey: publishedQuery.queryKey,
      exact: true,
      refetchType: 'none',
    })
    const { store } = renderHook(() => useWorkflowInit(), undefined, queryClient)
    await waitFor(() =>
      expect(queryClient.getQueryState(publishedQuery.queryKey)?.status).toBe('error'),
    )
    act(() => {
      store.getState().setPublishedAt(123)
      store.getState().setLastPublishedHasUserInput(true)
    })
    await act(async () => defaults.resolve([]))
    expect(store.getState().publishedAt).toBe(123_000)
    expect(store.getState().lastPublishedHasUserInput).toBe(true)
    consoleError.mockRestore()
  })

  it('keeps native publication while a replacement query is pending and later fails', async () => {
    const defaults = createDeferred<[]>()
    const oldPublished = createDeferred<null>()
    const replacement = createDeferred<null>()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    mockFetchNodesDefaultConfigs.mockReturnValue(defaults.promise)
    mockFetchPublishedWorkflow
      .mockReturnValueOnce(oldPublished.promise)
      .mockReturnValueOnce(replacement.promise)
    const queryClient = createAccountProfileQueryClient({ id: 'user-1' })
    const publishedQuery = appWorkflowQueryOptions('app-1')
    queryClient.setQueryData<WorkflowResponse | null>(publishedQuery.queryKey, null)
    await queryClient.invalidateQueries({
      queryKey: publishedQuery.queryKey,
      exact: true,
      refetchType: 'none',
    })
    const { store } = renderHook(() => useWorkflowInit(), undefined, queryClient)
    await waitFor(() => expect(mockFetchPublishedWorkflow).toHaveBeenCalledOnce())
    let replacementQuery!: Promise<unknown>
    await act(async () => {
      await queryClient.cancelQueries({ queryKey: publishedQuery.queryKey, exact: true })
      replacementQuery = queryClient
        .query({ ...publishedQuery, staleTime: 0 })
        .catch(() => undefined)
    })
    await waitFor(() => expect(mockFetchPublishedWorkflow).toHaveBeenCalledTimes(2))
    act(() => {
      store.getState().setPublishedAt(123)
      store.getState().setLastPublishedHasUserInput(true)
    })
    await act(async () => defaults.resolve([]))
    expect(store.getState().publishedAt).toBe(123_000)
    await act(async () => {
      replacement.reject(new Error('replacement GET failed'))
      await replacementQuery
      oldPublished.resolve(null)
    })
    expect(store.getState().publishedAt).toBe(123_000)
    expect(store.getState().lastPublishedHasUserInput).toBe(true)
    consoleError.mockRestore()
  })
})
