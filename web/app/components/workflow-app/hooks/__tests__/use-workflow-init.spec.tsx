import type { ReactNode, RefObject } from 'react'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, waitFor } from '@testing-library/react'
import { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { WORKFLOW_DRAFT_REPLACED } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContext } from '@/context/event-emitter'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import { renderHook as renderHookWithConsoleState } from '@/test/console/render'
import { AppACLPermission } from '@/utils/permission'
import { useWorkflowInit } from '../use-workflow-init'

const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetLastAppliedReplacementId = vi.fn()
const mockAdvanceDraftReplacementEpoch = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetToolPublished = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetLastPublishedHasUserInput = vi.fn()
const mockSetFileUploadConfig = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
const mockWorkflowStoreGetState = vi.fn()
const mockFetchNodesDefaultConfigs = vi.fn()
const mockFetchPublishedWorkflow = vi.fn()
const mockSyncWorkflowDraft = vi.fn()
const EventEmitterProvider = EventEmitterContext.Provider

const renderHook = <Result,>(
  callback: () => Result,
  eventEmitter?: EventEmitter<EventEmitterValue>,
) => {
  const QueryWrapper = createAccountProfileQueryWrapper({ id: 'user-1' })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryWrapper>
      <EventEmitterProvider value={{ eventEmitter: eventEmitter ?? null }}>
        {children}
      </EventEmitterProvider>
    </QueryWrapper>
  )
  return renderHookWithConsoleState(callback, { wrapper: Wrapper })
}

let appStoreState: {
  appDetail: {
    id: string
    name: string
    mode: string
    permission_keys?: string[]
    maintainer?: string
  }
}

let workflowConfigState: {
  data: Record<string, unknown> | null
  isLoading: boolean
}

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      appId: string
      setSyncWorkflowDraftHash: ReturnType<typeof vi.fn>
      setLastAppliedReplacementId: ReturnType<typeof vi.fn>
    }) => T,
  ): T =>
    selector({
      appId: 'app-1',
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setLastAppliedReplacementId: mockSetLastAppliedReplacementId,
    }),
  useWorkflowStore: () => ({
    setState: mockWorkflowStoreSetState,
    getState: mockWorkflowStoreGetState,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: typeof appStoreState) => T): T => selector(appStoreState),
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
      appStoreState.appDetail.mode === 'workflow'
        ? [{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }]
        : [{ id: 'start', data: { type: BlockEnum.Start } }],
    edges: [],
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useWorkflowConfig: (_url: string, onSuccess: (config: Record<string, unknown>) => void) => {
    if (workflowConfigState.data) onSuccess(workflowConfigState.data)
    return workflowConfigState
  },
}))

vi.mock('@/service/workflow-queries', () => ({
  appWorkflowQueryOptions: (appId: string) => ({
    queryKey: ['workflow', 'publish', appId],
    queryFn: () => mockFetchPublishedWorkflow(`/apps/${appId}/workflows/publish`),
  }),
}))

const mockFetchWorkflowDraft = vi.fn()

vi.mock('@/service/workflow', () => ({
  fetchAppWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
  syncWorkflowDraft: (...args: unknown[]) => mockSyncWorkflowDraft(...args),
  fetchNodesDefaultConfigs: (...args: unknown[]) => mockFetchNodesDefaultConfigs(...args),
}))

const notExistError = () =>
  new Response(JSON.stringify({ code: 'draft_workflow_not_exist' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })

const draftResponse = {
  id: 'draft-id',
  graph: {
    nodes: [{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }],
    edges: [],
  },
  hash: 'server-hash',
  last_replacement_id: null,
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
    vi.clearAllMocks()
    appStoreState = {
      appDetail: {
        id: 'app-1',
        name: 'Test',
        mode: 'workflow',
        permission_keys: [AppACLPermission.Edit],
      },
    }
    workflowConfigState = { data: null, isLoading: false }
    mockWorkflowStoreGetState.mockReturnValue({
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setToolPublished: mockSetToolPublished,
      setPublishedAt: mockSetPublishedAt,
      setLastPublishedHasUserInput: mockSetLastPublishedHasUserInput,
      setFileUploadConfig: mockSetFileUploadConfig,
      advanceDraftReplacementEpoch: mockAdvanceDraftReplacementEpoch,
    })
    mockFetchNodesDefaultConfigs.mockResolvedValue([])
    mockFetchPublishedWorkflow.mockResolvedValue({ created_at: 0, graph: { nodes: [], edges: [] } })
    mockFetchWorkflowDraft.mockRejectedValueOnce(notExistError())
    mockSyncWorkflowDraft.mockReset()
  })

  it('exposes a failed draft GET to the route error boundary instead of loading forever', async () => {
    const loadError = new TypeError('Invalid app workflow draft graph')
    mockFetchWorkflowDraft.mockReset().mockRejectedValue(loadError)

    const { result } = renderHook(() => useWorkflowInit({ current: false }))
    await waitFor(() => {
      expect(result.current.initializationError).toBe(loadError)
    })
    expect(result.current.isLoading).toBe(true)
  })

  it('does not create a draft for an unrelated HTTP 404 response', async () => {
    mockFetchWorkflowDraft.mockReset().mockRejectedValue(
      new Response(JSON.stringify({ code: 'app_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { result } = renderHook(() => useWorkflowInit({ current: false }))
    await waitFor(() => expect(result.current.initializationError).toBeInstanceOf(Error))
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it.each([undefined, { x: 120, y: -80, zoom: 0.75 }])(
    'should preserve the initial draft viewport as %j',
    async (viewport) => {
      mockFetchWorkflowDraft.mockReset().mockResolvedValue({
        ...draftResponse,
        graph: { ...draftResponse.graph, viewport },
      })

      const { result } = renderHook(() => useWorkflowInit({ current: false }))

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(result.current.data?.graph.viewport).toEqual(viewport)
    },
  )

  it('loads draft, block defaults and published workflow with the constructor identity', async () => {
    appStoreState.appDetail.id = 'other-app'
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    const { result } = renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('app-1')
    expect(mockFetchNodesDefaultConfigs).toHaveBeenCalledWith(
      '/apps/app-1/workflows/default-workflow-block-configs',
    )
    expect(mockFetchPublishedWorkflow).toHaveBeenCalledWith('/apps/app-1/workflows/publish')
    expect(mockWorkflowStoreSetState).not.toHaveBeenCalledWith(
      expect.objectContaining({ appId: expect.anything() }),
    )
  })

  it('loads the committed draft when another tab creates it after the initial 404', async () => {
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())
      .mockResolvedValueOnce({
        ...draftResponse,
        hash: 'imported-hash',
        last_replacement_id: 'import-concurrent',
      })
    mockSyncWorkflowDraft.mockRejectedValueOnce({ status: 409 })

    const { result } = renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => expect(result.current.data?.hash).toBe('imported-hash'))
    expect(result.current.data?.last_replacement_id).toBe('import-concurrent')
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
  })

  it('loads the committed draft when the workflow route mounts after the sidebar import', async () => {
    const eventEmitter = new EventEmitter<EventEmitterValue>()
    const importedDraft = {
      ...draftResponse,
      hash: 'imported-hash',
      features: { opening_statement: 'Imported opening' },
    }
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(importedDraft)

    eventEmitter.emit({
      type: WORKFLOW_DRAFT_REPLACED,
      payload: {
        appId: 'app-1',
        draft: importedDraft,
        workflowData: { nodes: [], edges: [], hash: importedDraft.hash },
      },
    })

    const { result } = renderHook(() => useWorkflowInit({ current: false }), eventEmitter)

    await waitFor(() => expect(result.current.data?.hash).toBe('imported-hash'))
    expect(result.current.data?.features).toEqual(importedDraft.features)
    expect(result.current.canvasInitEpoch).toBe(0)
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('does not show a stale initial draft after a sidebar import commits before the canvas mounts', async () => {
    let resolveInitialDraft!: (draft: typeof draftResponse) => void
    mockFetchWorkflowDraft.mockReset().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInitialDraft = resolve
      }),
    )
    const eventEmitter = new EventEmitter<EventEmitterValue>()
    const canvasReadyRef: RefObject<boolean> = { current: false }
    const { result } = renderHook(() => useWorkflowInit(canvasReadyRef), eventEmitter)

    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1))

    act(() => {
      eventEmitter.emit({
        type: WORKFLOW_DRAFT_REPLACED,
        payload: {
          appId: 'app-1',
          draft: { ...draftResponse, hash: 'imported-hash' },
          workflowData: { nodes: [], edges: [], hash: 'imported-hash' },
        },
      })
    })

    expect(result.current.data?.hash).toBe('imported-hash')
    expect(result.current.isLoading).toBe(false)
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveInitialDraft({ ...draftResponse, hash: 'stale-hash' })
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data?.hash).toBe('imported-hash')
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalledWith('stale-hash')
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('imported-hash')
  })

  it('does not create an empty draft from a superseded initial not-found response', async () => {
    let rejectInitialDraft!: (error: ReturnType<typeof notExistError>) => void
    mockFetchWorkflowDraft.mockReset().mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectInitialDraft = reject
      }),
    )
    const eventEmitter = new EventEmitter<EventEmitterValue>()
    const { result } = renderHook(() => useWorkflowInit({ current: false }), eventEmitter)

    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1))
    act(() => {
      eventEmitter.emit({
        type: WORKFLOW_DRAFT_REPLACED,
        payload: {
          appId: 'app-1',
          draft: { ...draftResponse, hash: 'imported-hash' },
          workflowData: { nodes: [], edges: [] },
        },
      })
    })

    await act(async () => {
      rejectInitialDraft(notExistError())
    })
    await waitFor(() => expect(result.current.data?.hash).toBe('imported-hash'))
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('replaces the prepared draft while another gate hides the canvas', async () => {
    mockFetchWorkflowDraft
      .mockReset()
      .mockResolvedValueOnce({ ...draftResponse, hash: 'initial-hash' })
    const eventEmitter = new EventEmitter<EventEmitterValue>()
    const canvasReadyRef: RefObject<boolean> = { current: false }
    const { result } = renderHook(() => useWorkflowInit(canvasReadyRef), eventEmitter)

    await waitFor(() => expect(result.current.data?.hash).toBe('initial-hash'))
    expect(result.current.isLoading).toBe(false)

    act(() => {
      eventEmitter.emit({
        type: WORKFLOW_DRAFT_REPLACED,
        payload: {
          appId: 'app-1',
          draft: {
            ...draftResponse,
            hash: 'initial-hash',
            features: { opening_statement: 'Imported opening' },
          },
          workflowData: { nodes: [], edges: [], hash: 'initial-hash' },
        },
      })
    })

    expect(result.current.data?.hash).toBe('initial-hash')
    expect(result.current.data?.features).toEqual({ opening_statement: 'Imported opening' })
    expect(result.current.canvasInitEpoch).toBe(1)
    expect(result.current.isLoading).toBe(false)
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('leaves import application to the mounted canvas listener', async () => {
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    const eventEmitter = new EventEmitter<EventEmitterValue>()
    const canvasReadyRef: RefObject<boolean> = { current: true }
    const { result } = renderHook(() => useWorkflowInit(canvasReadyRef), eventEmitter)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => {
      eventEmitter.emit({
        type: WORKFLOW_DRAFT_REPLACED,
        payload: {
          appId: 'app-1',
          draft: { ...draftResponse, hash: 'imported-hash' },
          workflowData: { nodes: [], edges: [], hash: 'imported-hash' },
        },
      })
    })

    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(result.current.data?.hash).toBe('server-hash')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.canvasInitEpoch).toBe(0)
  })

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

    const { result } = renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
      ])
    })

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        showOnboarding: false,
        shouldAutoOpenStartNodeSelector: false,
        hasSelectedStartNode: false,
        hasShownOnboarding: true,
      }),
    )
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          graph: {
            nodes: [],
            edges: [],
          },
        }),
      }),
    )
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-workflow-hash')
  })

  it('should keep creating the first backend draft for advanced chat apps', async () => {
    appStoreState = {
      appDetail: {
        id: 'app-1',
        name: 'Test',
        mode: 'advanced-chat',
        permission_keys: [AppACLPermission.Edit],
      },
    }
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())
      .mockResolvedValueOnce(draftResponse)
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1 })

    renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() =>
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: {
              nodes: [{ id: 'start', data: { type: BlockEnum.Start } }],
              edges: [],
            },
          }),
        }),
      ),
    )
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        showOnboarding: false,
        shouldAutoOpenStartNodeSelector: false,
        hasShownOnboarding: false,
      }),
    )
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
  })

  it('should keep readonly users local when the first workflow draft does not exist', async () => {
    appStoreState = {
      appDetail: {
        id: 'app-1',
        name: 'Test',
        mode: 'workflow',
        permission_keys: [AppACLPermission.ViewLayout],
      },
    }
    mockFetchWorkflowDraft.mockReset().mockRejectedValueOnce(notExistError())

    const { result } = renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.graph.nodes).toEqual([
      { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
    ])
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        envSecrets: {},
        environmentVariables: [],
        conversationVariables: [],
        isWorkflowDataLoaded: true,
      }),
    )
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('')
    expect(result.current.data?.graph.viewport).toBeUndefined()
  })

  it('should restore a local start placeholder when an existing workflow draft has an empty graph', async () => {
    mockFetchWorkflowDraft.mockReset().mockResolvedValue({
      ...draftResponse,
      graph: { nodes: [], edges: [] },
      hash: 'empty-draft-hash',
    })

    const { result } = renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
      ])
    })

    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('empty-draft-hash')
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

    const { result } = renderHook(() => useWorkflowInit({ current: false }))

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
      data: { enabled: true, sizeLimit: 20 },
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

    const { result } = renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => {
      expect(result.current.data?.hash).toBe('server-hash')
    })

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ appName: 'Test' })
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        envSecrets: { 'env-secret': 'top-secret' },
        environmentVariables: [
          { id: 'env-secret', value_type: 'secret', value: '[__HIDDEN__]', name: 'SECRET' },
          { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
        ],
        conversationVariables: [{ id: 'conversation-1' }],
        isWorkflowDataLoaded: true,
      }),
    )
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
      nodesDefaultConfigs: {
        start: { title: 'Start Config' },
      },
    })
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('server-hash')
    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(9)
    expect(mockSetToolPublished).toHaveBeenCalledWith(true)
    expect(mockSetPublishedAt).toHaveBeenCalledWith(99)
    expect(mockSetLastPublishedHasUserInput).toHaveBeenCalledWith(true)
    expect(mockSetFileUploadConfig).toHaveBeenCalledWith({ enabled: true, sizeLimit: 20 })
    expect(result.current.fileUploadConfigResponse).toEqual({ enabled: true, sizeLimit: 20 })
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

    renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => {
      expect(mockSetPublishedAt).toHaveBeenCalledWith(99)
      expect(mockSetLastPublishedHasUserInput).toHaveBeenCalledWith(true)
    })

    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('should keep node defaults when loading published metadata fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    mockFetchNodesDefaultConfigs.mockResolvedValue([
      { type: 'start', config: { title: 'Start Config' } },
    ])
    mockFetchPublishedWorkflow.mockRejectedValue(new Error('published workflow failed'))

    renderHook(() => useWorkflowInit({ current: false }))

    await waitFor(() => {
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
        nodesDefaultConfigs: {
          start: { title: 'Start Config' },
        },
      })
      expect(mockSetLastPublishedHasUserInput).toHaveBeenCalledWith(false)
    })

    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
