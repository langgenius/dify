import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import WorkflowApp from '../index'

const mockSetTriggerStatuses = vi.fn()
const mockSetInputs = vi.fn()
const mockSetShowInputsPanel = vi.fn()
const mockSetShowDebugAndPreviewPanel = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
const mockDebouncedCancel = vi.fn()
const mockFetchRunDetail = vi.fn()
const mockInitialNodes = vi.fn()
const mockInitialEdges = vi.fn()
const mockGetWorkflowRunAndTraceUrl = vi.fn()

let appStoreState: {
  appDetail?: {
    id: string
    mode: string
  }
}

let workflowInitState: {
  data: {
    graph: {
      nodes: Array<Record<string, unknown>>
      edges: Array<Record<string, unknown>>
      viewport: { x: number, y: number, zoom: number }
    }
    features: Record<string, unknown>
  } | null
  isLoading: boolean
  fileUploadConfigResponse: Record<string, unknown> | null
}

let appContextState: {
  isLoadingCurrentWorkspace: boolean
  currentWorkspace: {
    id?: string
  }
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

const mockWorkflowStore = {
  setState: mockWorkflowStoreSetState,
  getState: () => ({
    setInputs: mockSetInputs,
    setShowInputsPanel: mockSetShowInputsPanel,
    setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
    debouncedSyncWorkflowDraft: {
      cancel: mockDebouncedCancel,
    },
  }),
}

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: typeof appStoreState) => T) => selector(appStoreState),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => mockWorkflowStore,
}))

vi.mock('@/app/components/workflow/store/trigger-status', () => ({
  useTriggerStatusStore: () => ({
    setTriggerStatuses: mockSetTriggerStatuses,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => appContextState,
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'replayRunId' ? searchParamsValue : null),
  }),
}))

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => mockFetchRunDetail(...args),
}))

vi.mock('@/service/use-tools', () => ({
  useAppTriggers: () => appTriggersState,
}))

vi.mock('@/app/components/workflow-app/hooks/use-workflow-init', () => ({
  useWorkflowInit: () => workflowInitState,
}))

vi.mock('@/app/components/workflow-app/hooks/use-get-run-and-trace-url', () => ({
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

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">loading</div>,
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
  default: ({
    nodes,
    edges,
    children,
  }: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    children: ReactNode
  }) => (
    <div data-testid="workflow-default-context" data-nodes={JSON.stringify(nodes)} data-edges={JSON.stringify(edges)}>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({
    children,
  }: {
    injectWorkflowStoreSliceFn: unknown
    children: ReactNode
  }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

vi.mock('@/app/components/workflow-app/components/workflow-main', () => ({
  default: ({
    nodes,
    edges,
    viewport,
  }: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    viewport: Record<string, unknown>
  }) => (
    <div
      data-testid="workflow-app-main"
      data-nodes={JSON.stringify(nodes)}
      data-edges={JSON.stringify(edges)}
      data-viewport={JSON.stringify(viewport)}
    />
  ),
}))

describe('WorkflowApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appStoreState = {
      appDetail: {
        id: 'app-1',
        mode: 'workflow',
      },
    }
    workflowInitState = {
      data: {
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
    }
    appContextState = {
      isLoadingCurrentWorkspace: false,
      currentWorkspace: { id: 'workspace-1' },
    }
    appTriggersState = {}
    searchParamsValue = null
    mockFetchRunDetail.mockResolvedValue({ inputs: null })
    mockInitialNodes.mockReturnValue([{ id: 'node-1' }])
    mockInitialEdges.mockReturnValue([{ id: 'edge-1' }])
    mockGetWorkflowRunAndTraceUrl.mockReturnValue({ runUrl: '/runs/run-1' })
  })

  it('should render the loading shell while workflow data is still loading', () => {
    workflowInitState = {
      data: null,
      isLoading: true,
      fileUploadConfigResponse: null,
    }

    render(<WorkflowApp />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByTestId('workflow-app-main')).not.toBeInTheDocument()
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

    render(<WorkflowApp />)

    expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-default-context')).toHaveAttribute('data-nodes', JSON.stringify([{ id: 'node-1' }]))
    expect(screen.getByTestId('workflow-default-context')).toHaveAttribute('data-edges', JSON.stringify([{ id: 'edge-1' }]))
    expect(screen.getByTestId('workflow-app-main')).toHaveAttribute('data-viewport', JSON.stringify({ x: 1, y: 2, zoom: 3 }))
    expect(screen.getByTestId('features-provider')).toBeInTheDocument()
    expect(mockSetTriggerStatuses).toHaveBeenCalledWith({
      'trigger-enabled': 'enabled',
      'trigger-disabled': 'disabled',
    })
  })

  it('should not sync trigger statuses when trigger data is unavailable', () => {
    render(<WorkflowApp />)

    expect(screen.getByTestId('workflow-app-main')).toBeInTheDocument()
    expect(mockSetTriggerStatuses).not.toHaveBeenCalled()
  })

  it('should replay workflow inputs from replayRunId and clean up workflow state on unmount', async () => {
    searchParamsValue = 'run-1'
    mockFetchRunDetail.mockResolvedValue({
      inputs: '{"sys.query":"hidden","foo":"bar","count":2,"flag":true,"obj":{"nested":true},"nil":null}',
    })

    const { unmount } = render(<WorkflowApp />)

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

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ isWorkflowDataLoaded: false })
    expect(mockDebouncedCancel).toHaveBeenCalled()
  })

  it('should skip replay lookups when replayRunId is missing', () => {
    render(<WorkflowApp />)

    expect(mockGetWorkflowRunAndTraceUrl).not.toHaveBeenCalled()
    expect(mockFetchRunDetail).not.toHaveBeenCalled()
    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('should skip replay fetches when the resolved run url is empty', async () => {
    searchParamsValue = 'run-1'
    mockGetWorkflowRunAndTraceUrl.mockReturnValue({ runUrl: '' })

    render(<WorkflowApp />)

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

    render(<WorkflowApp />)

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

    render(<WorkflowApp />)

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/runs/run-1')
    })

    expect(mockSetInputs).not.toHaveBeenCalled()
    expect(mockSetShowInputsPanel).not.toHaveBeenCalled()
    expect(mockSetShowDebugAndPreviewPanel).not.toHaveBeenCalled()
  })
})
