import { render, screen } from '@testing-library/react'
import * as React from 'react'
import Panel from '../index'

type MockNodeData = {
  selected?: boolean
  title?: string
}

type MockNode = {
  id: string
  type: string
  data: MockNodeData
}

type MockPanelStoreState = {
  showEnvPanel: boolean
  isRestoring: boolean
  showWorkflowVersionHistoryPanel: boolean
  workflowCanvasWidth: number
  previewPanelWidth: number
  setPreviewPanelWidth: (value: number) => void
  setRightPanelWidth: (value: number) => void
  setOtherPanelWidth: (value: number) => void
}

class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()

  constructor(_callback: ResizeObserverCallback) {}
}

let mockNodes: MockNode[] = []
let mockPanelStoreState: MockPanelStoreState

vi.mock('reactflow', () => ({
  useStore: (selector: (state: { getNodes: () => MockNode[] }) => unknown) => selector({
    getNodes: () => mockNodes,
  }),
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => mockNodes,
      setNodes: vi.fn(),
    }),
  }),
}))

vi.mock('../../store', () => ({
  useStore: <T,>(selector: (state: MockPanelStoreState) => T) => selector(mockPanelStoreState),
}))

vi.mock('../../nodes', () => ({
  Panel: ({ id, data }: { id: string, data: MockNodeData }) => (
    <div data-testid="node-panel">{`${id}:${data.title || 'untitled'}`}</div>
  ),
}))

vi.mock('@/app/components/workflow/panel/env-panel', () => ({
  default: () => <div data-testid="env-panel">env-panel</div>,
}))

vi.mock('@/app/components/workflow/panel/version-history-panel', () => ({
  default: ({ latestVersionId }: { latestVersionId?: string }) => (
    <div data-testid="version-history-panel">{latestVersionId || 'none'}</div>
  ),
}))

vi.mock('@/next/dynamic', async () => {
  const ReactModule = await import('react')

  return {
    default: (
      loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
    ) => {
      const DynamicComponent = (props: Record<string, unknown>) => {
        const [Loaded, setLoaded] = ReactModule.useState<React.ComponentType<Record<string, unknown>> | null>(null)

        ReactModule.useEffect(() => {
          let mounted = true
          loader().then((mod) => {
            if (mounted)
              setLoaded(() => mod.default)
          })
          return () => {
            mounted = false
          }
        }, [])

        return Loaded ? <Loaded {...props} /> : null
      }

      return DynamicComponent
    },
  }
})

describe('Panel', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = []
    mockPanelStoreState = {
      showEnvPanel: false,
      isRestoring: false,
      showWorkflowVersionHistoryPanel: false,
      workflowCanvasWidth: 0,
      previewPanelWidth: 420,
      setPreviewPanelWidth: vi.fn(),
      setRightPanelWidth: vi.fn(),
      setOtherPanelWidth: vi.fn(),
    }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: 640,
      height: 320,
      top: 0,
      right: 640,
      bottom: 320,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('should render slots, selected node details, and secondary panels while constraining oversized preview widths', async () => {
    mockNodes = [{
      id: 'node-1',
      type: 'custom',
      data: {
        selected: true,
        title: 'Selected Node',
      },
    }]
    mockPanelStoreState = {
      ...mockPanelStoreState,
      showEnvPanel: true,
      showWorkflowVersionHistoryPanel: true,
      workflowCanvasWidth: 1000,
      previewPanelWidth: 520,
    }

    render(
      <Panel
        components={{
          left: <div>left-slot</div>,
          right: <div>right-slot</div>,
        }}
        versionHistoryPanelProps={{ latestVersionId: 'version-1' }}
      />,
    )

    expect(screen.getByText('left-slot')).toBeInTheDocument()
    expect(screen.getByText('right-slot')).toBeInTheDocument()
    expect(screen.getByTestId('node-panel')).toHaveTextContent('node-1:Selected Node')
    expect(screen.getByTestId('env-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('version-history-panel')).toHaveTextContent('version-1')
    expect(mockPanelStoreState.setPreviewPanelWidth).toHaveBeenCalledWith(400)
    expect(mockPanelStoreState.setRightPanelWidth).toHaveBeenCalledWith(640)
    expect(mockPanelStoreState.setOtherPanelWidth).toHaveBeenCalledWith(640)
  })

  it('should skip node and auxiliary panels when there is no selected node or open side panel state', () => {
    render(
      <Panel
        components={{
          left: <div>left-only</div>,
        }}
      />,
    )

    expect(screen.getByText('left-only')).toBeInTheDocument()
    expect(screen.queryByTestId('node-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('env-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('version-history-panel')).not.toBeInTheDocument()
    expect(mockPanelStoreState.setPreviewPanelWidth).not.toHaveBeenCalled()
  })
})
