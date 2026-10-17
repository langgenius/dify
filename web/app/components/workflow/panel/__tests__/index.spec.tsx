import type { Shape } from '../../store/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import * as React from 'react'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
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

type MockPanelStoreState = Partial<Shape>

type MockResizeMode = 'borderBox' | 'contentRect' | 'fallback'

let mockResizeModes: MockResizeMode[] = []
let mockResizeObservers: MockResizeObserver[] = []

const createResizeEntry = (mode: MockResizeMode): ResizeObserverEntry =>
  ({
    borderBoxSize:
      mode === 'borderBox' ? ([{ inlineSize: 720, blockSize: 0 }] as ResizeObserverSize[]) : [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
    contentRect: {
      width: mode === 'contentRect' ? 530 : 0,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly,
    target: document.createElement('div'),
  }) as unknown as ResizeObserverEntry

class MockResizeObserver {
  callback: ResizeObserverCallback

  observe = vi.fn(() => {
    if (!mockResizeModes.length) return

    this.callback(mockResizeModes.map(createResizeEntry), this)
  })

  disconnect = vi.fn()
  unobserve = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    mockResizeObservers.push(this)
  }
}

let mockNodes: MockNode[] = []
let mockPanelStoreState: MockPanelStoreState

function FlowFixture({ children }: { children: React.ReactNode }) {
  const flow = useStoreApi()
  useLayoutEffect(() => {
    flow
      .getState()
      .setNodes(
        mockNodes.map((node) =>
          createNode({ ...node, data: { ...createNode().data, ...node.data } }),
        ),
      )
  }, [flow])
  return children
}

const render = (ui: React.ReactElement) =>
  renderWorkflowComponent(
    <ReactFlowProvider>
      <FlowFixture>{ui}</FlowFixture>
    </ReactFlowProvider>,
    { initialStoreState: mockPanelStoreState },
  )

vi.mock('../../nodes/panel', () => ({
  default: ({ id, data }: { id: string; data: MockNodeData }) => (
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

vi.mock('next/dynamic', async () => {
  const ReactModule = await import('react')

  return {
    default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
      const DynamicComponent = (props: Record<string, unknown>) => {
        const [Loaded, setLoaded] = ReactModule.useState<React.ComponentType<
          Record<string, unknown>
        > | null>(null)

        ReactModule.useEffect(() => {
          let mounted = true
          loader().then((mod) => {
            if (mounted) setLoaded(() => mod.default)
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
    mockResizeModes = []
    mockResizeObservers = []
    mockPanelStoreState = {
      showEnvPanel: false,
      isRestoring: false,
      showWorkflowVersionHistoryPanel: false,
      workflowCanvasWidth: 0,
      previewPanelWidth: 420,
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
    mockNodes = [
      {
        id: 'node-1',
        type: 'custom',
        data: {
          selected: true,
          title: 'Selected Node',
        },
      },
    ]
    mockPanelStoreState = {
      ...mockPanelStoreState,
      showEnvPanel: true,
      showWorkflowVersionHistoryPanel: true,
      workflowCanvasWidth: 1000,
      previewPanelWidth: 520,
    }

    const { store } = render(
      <Panel
        components={{
          left: <div>left-slot</div>,
          right: <div>right-slot</div>,
        }}
        versionHistoryPanelProps={{
          latestVersionId: 'version-1',
        }}
      />,
    )

    expect(screen.getByText('left-slot')).toBeInTheDocument()
    expect(screen.getByText('right-slot')).toBeInTheDocument()
    expect(screen.getByTestId('node-panel')).toHaveTextContent('node-1:Selected Node')
    expect(screen.getByTestId('env-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('version-history-panel')).toHaveTextContent('version-1')
    expect(store.getState().previewPanelWidth).toBe(400)
    await waitFor(() => {
      expect(store.getState().rightPanelWidth).toBe(640)
      expect(store.getState().otherPanelWidth).toBe(640)
    })
  })

  it('should skip node and auxiliary panels when there is no selected node or open side panel state', () => {
    const { store } = render(
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
    expect(store.getState().previewPanelWidth).toBe(420)
  })

  it('should derive observer widths from border-box, content-rect, and fallback values and disconnect on unmount', async () => {
    const { unmount, store } = render(<Panel />)

    await waitFor(() => {
      expect(store.getState().rightPanelWidth).toBe(640)
      expect(store.getState().otherPanelWidth).toBe(640)
    })

    act(() => {
      mockResizeObservers.forEach((observer) => {
        observer.callback([createResizeEntry('borderBox')], observer)
      })
    })

    await waitFor(() => {
      expect(store.getState().rightPanelWidth).toBe(720)
      expect(store.getState().otherPanelWidth).toBe(720)
    })

    act(() => {
      mockResizeObservers.forEach((observer) => {
        observer.callback([createResizeEntry('contentRect')], observer)
      })
    })

    await waitFor(() => {
      expect(store.getState().rightPanelWidth).toBe(530)
      expect(store.getState().otherPanelWidth).toBe(530)
    })

    act(() => {
      mockResizeObservers.forEach((observer) => {
        observer.callback([createResizeEntry('fallback')], observer)
      })
    })

    await waitFor(() => {
      expect(store.getState().rightPanelWidth).toBe(640)
      expect(store.getState().otherPanelWidth).toBe(640)
    })

    unmount()

    expect(mockResizeObservers).toHaveLength(2)
    mockResizeObservers.forEach((observer) => expect(observer.disconnect).toHaveBeenCalledTimes(1))
  })
})
