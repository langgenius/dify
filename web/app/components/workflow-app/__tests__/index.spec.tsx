import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { useStore } from '@/app/components/workflow/store'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import WorkflowApp from '../index'

const mockUseAppTriggers = vi.fn()
const mockSetTriggerStatuses = vi.fn()
const mockSetInputs = vi.fn()
const mockSetShowInputsPanel = vi.fn()
const mockSetShowDebugAndPreviewPanel = vi.fn()
let mockIsWorkflowDataLoaded = true
let mockWorkflowRunAbortController: AbortController | null = null
const mockWorkflowStoreSetState = vi.fn((state: Record<string, unknown>) => {
  if (typeof state.isWorkflowDataLoaded === 'boolean')
    mockIsWorkflowDataLoaded = state.isWorkflowDataLoaded
})
const mockDebouncedCancel = vi.fn()
const mockFinalDraftSync = vi.fn()
const mockFetchRunDetail = vi.fn()
const mockInitialNodes = vi.fn()
const mockInitialEdges = vi.fn()
const mockGetWorkflowRunAndTraceUrl = vi.fn()
let mockCanvasReadyRef: RefObject<boolean> | undefined
let mockCanvasListenerMounted = true

let appDetailFixture: AppDetailWithSite
let queryClient = createConsoleQueryClient()

let workflowInitState: {
  data: {
    hash: string
    last_replacement_id: string | null
    graph: {
      nodes: Array<Record<string, unknown>>
      edges: Array<Record<string, unknown>>
      viewport: { x: number; y: number; zoom: number }
    }
    features: Record<string, unknown>
  } | null
  isLoading: boolean
  fileUploadConfigResponse: Record<string, unknown> | null
  canvasInitEpoch: number
}

let consoleState: {
  isLoadingCurrentWorkspace: boolean
  currentWorkspace: {
    id?: string
  }
  userProfile: {
    id: string
  }
  workspacePermissionKeys: string[]
}

let appTriggersState: {
  data?: {
    data: Array<{
      node_id: string
      status: string
    }>
  }
}

let searchParamsValue: string | null = null

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    queryClient,
    accountProfile: consoleState.userProfile,
    appDetail: appDetailFixture,
  })

const mockWorkflowStore = {
  setState: mockWorkflowStoreSetState,
  getState: () => ({
    isWorkflowDataLoaded: mockIsWorkflowDataLoaded,
    workflowRunAbortController: mockWorkflowRunAbortController,
    setInputs: mockSetInputs,
    setShowInputsPanel: mockSetShowInputsPanel,
    setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
    debouncedSyncWorkflowDraft: {
      cancel: mockDebouncedCancel,
    },
  }),
}

vi.mock('@/app/components/workflow/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/workflow/store')>()),
  useWorkflowStore: () => mockWorkflowStore,
}))

vi.mock('@/app/components/workflow/store/trigger-status', () => ({
  useTriggerStatusStore: () => ({
    setTriggerStatuses: mockSetTriggerStatuses,
  }),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isLoadingCurrentWorkspace: consoleState.isLoadingCurrentWorkspace,
    currentWorkspace: consoleState.currentWorkspace,
    userProfile: consoleState.userProfile,
    workspacePermissionKeys: consoleState.workspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    isLoadingCurrentWorkspace: consoleState.isLoadingCurrentWorkspace,
    currentWorkspace: consoleState.currentWorkspace,
    userProfile: consoleState.userProfile,
    workspacePermissionKeys: consoleState.workspacePermissionKeys,
  }))
})

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'replayRunId' ? searchParamsValue : null),
  }),
}))

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => mockFetchRunDetail(...args),
}))

vi.mock('@/service/use-tools', () => ({
  useAppTriggers: (...args: unknown[]) => {
    mockUseAppTriggers(...args)
    return appTriggersState
  },
}))

vi.mock('../hooks/use-workflow-init', () => ({
  useWorkflowInit: (canvasReadyRef: RefObject<boolean>) => {
    mockCanvasReadyRef = canvasReadyRef
    return workflowInitState
  },
}))

vi.mock('../hooks/use-get-run-and-trace-url', () => ({
  useGetRunAndTraceUrl: () => ({
    getWorkflowRunAndTraceUrl: mockGetWorkflowRunAndTraceUrl,
  }),
}))

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    initialNodes: (...args: unknown[]) => mockInitialNodes(...args),
    initialEdges: (...args: unknown[]) => mockInitialEdges(...args),
  }
})

vi.mock('@/app/components/base/loading-placeholder', () => ({
  LoadingPlaceholder: () => <div data-testid="loading">loading</div>,
}))

vi.mock('@/app/components/base/features', () => ({
  FeaturesProvider: ({
    features,
    children,
  }: {
    features: Record<string, unknown>
    children: ReactNode
  }) => (
    <div data-testid="features-provider" data-features={JSON.stringify(features)}>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow', () => ({
  default: function WorkflowDefaultContextMock({
    nodes,
    edges,
    children,
  }: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    children: ReactNode
  }) {
    const [initialNodes] = useState(nodes)
    const [initialEdges] = useState(edges)
    return (
      <div
        data-testid="workflow-default-context"
        data-nodes={JSON.stringify(initialNodes)}
        data-edges={JSON.stringify(initialEdges)}
      >
        {children}
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow-app/components/workflow-main', () => ({
  default: function WorkflowMainMock({
    nodes,
    edges,
    viewport,
    initialReplacementId,
    onDraftReplacementListenerReadyChange,
  }: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    viewport: Record<string, unknown>
    initialReplacementId?: string | null
    onDraftReplacementListenerReadyChange?: (ready: boolean) => void
  }) {
    const appId = useStore((state) => state.appId)
    const inputs = useStore((state) => state.inputs)
    const setInputs = useStore((state) => state.setInputs)
    useEffect(() => {
      if (!mockCanvasListenerMounted) return
      onDraftReplacementListenerReadyChange?.(true)
      return () => {
        onDraftReplacementListenerReadyChange?.(false)
        const { debouncedSyncWorkflowDraft, isWorkflowDataLoaded } = mockWorkflowStore.getState()
        if (!isWorkflowDataLoaded) return

        debouncedSyncWorkflowDraft.cancel()
        mockFinalDraftSync()
      }
    }, [onDraftReplacementListenerReadyChange])

    if (!mockCanvasListenerMounted) return null

    return (
      <div
        role="region"
        aria-label="Workflow canvas"
        data-nodes={JSON.stringify(nodes)}
        data-edges={JSON.stringify(edges)}
        data-viewport={JSON.stringify(viewport)}
        data-initial-import-id={initialReplacementId ?? ''}
      >
        <span>{appId}</span>
        <input
          aria-label="Workflow query"
          value={String(inputs.query ?? '')}
          onChange={(event) => setInputs({ query: event.target.value })}
        />
      </div>
    )
  },
}))

describe('WorkflowApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanvasReadyRef = undefined
    mockCanvasListenerMounted = true
    mockIsWorkflowDataLoaded = true
    mockWorkflowRunAbortController = null
    appDetailFixture = createAppDetailFixture({
      id: 'app-1',
      mode: 'workflow',
      permission_keys: [AppACLPermission.TestAndRun],
    })
    queryClient = createConsoleQueryClient()
    seedAppDetail(queryClient, { id: 'route-app-a', mode: 'workflow' })
    seedAppDetail(queryClient, { id: 'route-app-b', mode: 'workflow' })
    workflowInitState = {
      data: {
        hash: 'initial-hash',
        last_replacement_id: null,
        graph: {
          nodes: [{ id: 'raw-node' }],
          edges: [{ id: 'raw-edge' }],
          viewport: { x: 1, y: 2, zoom: 3 },
        },
        features: {
          file_upload: {
            enabled: true,
          },
        },
      },
      isLoading: false,
      fileUploadConfigResponse: { enabled: true },
      canvasInitEpoch: 0,
    }
    consoleState = {
      isLoadingCurrentWorkspace: false,
      currentWorkspace: { id: 'workspace-1' },
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }
    appTriggersState = {}
    searchParamsValue = null
    mockFetchRunDetail.mockResolvedValue({ inputs: null })
    mockInitialNodes.mockReturnValue([{ id: 'node-1' }])
    mockInitialEdges.mockReturnValue([{ id: 'edge-1' }])
    mockGetWorkflowRunAndTraceUrl.mockReturnValue({ runUrl: '/runs/run-1' })
  })

  it('cancels run resources when the owning workflow session changes or exits', () => {
    const firstController = new AbortController()
    mockWorkflowRunAbortController = firstController
    const { rerender, unmount } = render(<WorkflowApp appId="route-app-a" />)
    rerender(<WorkflowApp appId="route-app-a" />)
    expect(firstController.signal.aborted).toBe(false)

    rerender(<WorkflowApp appId="route-app-b" />)
    expect(firstController.signal.aborted).toBe(true)
    const secondController = new AbortController()
    mockWorkflowRunAbortController = secondController
    expect(secondController.signal.aborted).toBe(false)
    unmount()
    expect(secondController.signal.aborted).toBe(true)
  })

  it('creates route identity before child requests and resets the workflow session when the route changes', () => {
    const { rerender } = render(<WorkflowApp appId="route-app-a" />)

    expect(mockUseAppTriggers.mock.calls[0]?.[0]).toBe('route-app-a')
    expect(screen.getByText('route-app-a')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Workflow query' }), {
      target: { value: 'Draft input from A' },
    })
    expect(screen.getByRole('textbox', { name: 'Workflow query' })).toHaveValue(
      'Draft input from A',
    )

    rerender(<WorkflowApp appId="route-app-b" />)

    expect(mockUseAppTriggers.mock.calls.at(-1)?.[0]).toBe('route-app-b')
    expect(screen.getByText('route-app-b')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Workflow query' })).toHaveValue('')
    expect(screen.queryByText('route-app-a')).not.toBeInTheDocument()
  })

  it('should render the loading shell while workflow data is still loading', () => {
    workflowInitState = {
      data: null,
      isLoading: true,
      fileUploadConfigResponse: null,
      canvasInitEpoch: 0,
    }

    render(<WorkflowApp appId="app-1" />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Workflow canvas' })).not.toBeInTheDocument()
    expect(mockCanvasReadyRef?.current).toBe(false)
  })

  it('marks the canvas ready only while its import listener is mounted beyond all loading gates', () => {
    workflowInitState.isLoading = true
    const { rerender, unmount } = render(<WorkflowApp appId="app-1" />)

    expect(mockCanvasReadyRef?.current).toBe(false)

    workflowInitState.isLoading = false
    consoleState.isLoadingCurrentWorkspace = true
    rerender(<WorkflowApp appId="app-1" />)
    expect(mockCanvasReadyRef?.current).toBe(false)

    consoleState.isLoadingCurrentWorkspace = false
    rerender(<WorkflowApp appId="app-1" />)
    expect(mockCanvasReadyRef?.current).toBe(true)

    workflowInitState.isLoading = true
    rerender(<WorkflowApp appId="app-1" />)
    expect(mockCanvasReadyRef?.current).toBe(false)

    unmount()
  })

  it('rebuilds initial graph and features for a committed import before the canvas listener mounts', () => {
    mockCanvasListenerMounted = false
    mockInitialNodes.mockImplementation((nodes: Array<Record<string, unknown>>) => nodes)
    mockInitialEdges.mockImplementation((edges: Array<Record<string, unknown>>) => edges)
    const { rerender } = render(<WorkflowApp appId="app-1" />)
    const firstContext = screen.getByTestId('workflow-default-context')
    const firstFeatures = screen.getByTestId('features-provider')

    expect(firstContext).toHaveAttribute('data-nodes', JSON.stringify([{ id: 'raw-node' }]))
    expect(mockCanvasReadyRef?.current).toBe(false)
    expect(screen.queryByRole('region', { name: 'Workflow canvas' })).not.toBeInTheDocument()

    const initialData = workflowInitState.data
    if (!initialData) throw new Error('Expected the initial workflow draft')
    workflowInitState.data = {
      ...initialData,
      hash: initialData.hash,
      graph: { ...initialData.graph, nodes: [{ id: 'imported-node' }] },
      features: { file_upload: { enabled: false } },
    }
    workflowInitState.canvasInitEpoch = 1
    rerender(<WorkflowApp appId="app-1" />)

    const nextContext = screen.getByTestId('workflow-default-context')
    expect(nextContext).not.toBe(firstContext)
    expect(nextContext).toHaveAttribute('data-nodes', JSON.stringify([{ id: 'imported-node' }]))
    expect(screen.getByTestId('features-provider')).not.toBe(firstFeatures)
    expect(JSON.parse(screen.getByTestId('features-provider').dataset.features ?? '{}')).toEqual(
      expect.objectContaining({ file: expect.objectContaining({ enabled: false }) }),
    )
    expect(mockCanvasReadyRef?.current).toBe(false)
  })

  it('preserves the mounted canvas when the import listener owns the update', () => {
    const { rerender } = render(<WorkflowApp appId="app-1" />)
    const firstContext = screen.getByTestId('workflow-default-context')
    const firstFeatures = screen.getByTestId('features-provider')
    const firstCanvas = screen.getByRole('region', { name: 'Workflow canvas' })
    expect(mockCanvasReadyRef?.current).toBe(true)

    rerender(<WorkflowApp appId="app-1" />)

    expect(screen.getByTestId('workflow-default-context')).toBe(firstContext)
    expect(screen.getByTestId('features-provider')).toBe(firstFeatures)
    expect(screen.getByRole('region', { name: 'Workflow canvas' })).toBe(firstCanvas)
    expect(mockFinalDraftSync).not.toHaveBeenCalled()
  })

  it('passes the hydrated import identity to the collaboration canvas', () => {
    if (!workflowInitState.data) throw new Error('Expected the initial workflow draft')
    workflowInitState.data.last_replacement_id = 'import-visible'

    render(<WorkflowApp appId="app-1" />)

    expect(screen.getByRole('region', { name: 'Workflow canvas' })).toHaveAttribute(
      'data-initial-import-id',
      'import-visible',
    )
  })

  it('should render the workflow app shell and sync trigger statuses when data is ready', () => {
    appTriggersState = {
      data: {
        data: [
          { node_id: 'trigger-enabled', status: 'enabled' },
          { node_id: 'trigger-disabled', status: 'paused' },
        ],
      },
    }

    render(<WorkflowApp appId="app-1" />)

    expect(screen.getByTestId('workflow-default-context')).toHaveAttribute(
      'data-nodes',
      JSON.stringify([{ id: 'node-1' }]),
    )
    expect(screen.getByTestId('workflow-default-context')).toHaveAttribute(
      'data-edges',
      JSON.stringify([{ id: 'edge-1' }]),
    )
    expect(screen.getByRole('region', { name: 'Workflow canvas' })).toHaveAttribute(
      'data-viewport',
      JSON.stringify({ x: 1, y: 2, zoom: 3 }),
    )
    expect(screen.getByTestId('features-provider')).toBeInTheDocument()
    expect(mockSetTriggerStatuses).toHaveBeenCalledWith({
      'trigger-enabled': 'enabled',
      'trigger-disabled': 'disabled',
    })
  })

  it('should not sync trigger statuses when trigger data is unavailable', () => {
    render(<WorkflowApp appId="app-1" />)

    expect(screen.getByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
    expect(mockSetTriggerStatuses).not.toHaveBeenCalled()
  })

  it('should replay workflow inputs from replayRunId', async () => {
    searchParamsValue = 'run-1'
    mockFetchRunDetail.mockResolvedValue({
      inputs:
        '{"sys.query":"hidden","foo":"bar","count":2,"flag":true,"obj":{"nested":true},"nil":null}',
    })

    const { unmount } = render(<WorkflowApp appId="app-1" />)

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/runs/run-1')
      expect(mockSetInputs).toHaveBeenCalledWith({
        foo: 'bar',
        count: 2,
        flag: true,
        obj: '{"nested":true}',
        nil: '',
      })
      expect(mockSetShowInputsPanel).toHaveBeenCalledWith(true)
      expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    })

    unmount()
  })

  it('should keep loaded workflow state available for the canvas unmount sync', () => {
    const { unmount } = render(<WorkflowApp appId="app-1" />)

    unmount()

    expect(mockFinalDraftSync).toHaveBeenCalledTimes(1)
    expect(mockDebouncedCancel).toHaveBeenCalledTimes(1)
  })

  it('should skip replay lookups when replayRunId is missing', () => {
    render(<WorkflowApp appId="app-1" />)

    expect(mockGetWorkflowRunAndTraceUrl).not.toHaveBeenCalled()
    expect(mockFetchRunDetail).not.toHaveBeenCalled()
    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('should skip replay lookups when test/run permission is missing', async () => {
    searchParamsValue = 'run-1'
    appDetailFixture = createAppDetailFixture({
      id: 'app-1',
      mode: 'workflow',
      permission_keys: [AppACLPermission.ViewLayout],
    })

    render(<WorkflowApp appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
    })

    expect(mockGetWorkflowRunAndTraceUrl).not.toHaveBeenCalled()
    expect(mockFetchRunDetail).not.toHaveBeenCalled()
    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('should skip replay fetches when the resolved run url is empty', async () => {
    searchParamsValue = 'run-1'
    mockGetWorkflowRunAndTraceUrl.mockReturnValue({ runUrl: '' })

    render(<WorkflowApp appId="app-1" />)

    await waitFor(() => {
      expect(mockGetWorkflowRunAndTraceUrl).toHaveBeenCalledWith('run-1')
    })

    expect(mockFetchRunDetail).not.toHaveBeenCalled()
    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('should stop replay recovery when workflow run inputs cannot be parsed', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    searchParamsValue = 'run-1'
    mockFetchRunDetail.mockResolvedValue({
      inputs: '{invalid-json}',
    })

    render(<WorkflowApp appId="app-1" />)

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/runs/run-1')
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to parse workflow run inputs',
      expect.any(Error),
    )
    expect(mockSetInputs).not.toHaveBeenCalled()
    expect(mockSetShowInputsPanel).not.toHaveBeenCalled()
    expect(mockSetShowDebugAndPreviewPanel).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('should ignore replay inputs when they only contain sys variables', async () => {
    searchParamsValue = 'run-1'
    mockFetchRunDetail.mockResolvedValue({
      inputs: '{"sys.query":"hidden","sys.user_id":"u-1"}',
    })

    render(<WorkflowApp appId="app-1" />)

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/runs/run-1')
    })

    expect(mockSetInputs).not.toHaveBeenCalled()
    expect(mockSetShowInputsPanel).not.toHaveBeenCalled()
    expect(mockSetShowDebugAndPreviewPanel).not.toHaveBeenCalled()
  })
})
