/**
 * Shared mutable ReactFlow mock state for hook/component tests.
 *
 * Mutate `rfState` in `beforeEach` to configure nodes/edges,
 * then assert on `rfState.setNodes`, `rfState.setEdges`, etc.
 *
 * Usage (one line at top of test file):
 * ```ts
 * vi.mock('reactflow', async () =>
 *   (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock(),
 * )
 * ```
 */
import * as React from 'react'

type MockNode = {
  id: string
  position: { x: number, y: number }
  width?: number | null
  height?: number | null
  parentId?: string
  data: Record<string, unknown>
}

type MockEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  data: Record<string, unknown>
}

type ReactFlowMockState = {
  nodes: MockNode[]
  edges: MockEdge[]
  transform: [number, number, number]
  setViewport: ReturnType<typeof vi.fn>
  setNodes: ReturnType<typeof vi.fn>
  setEdges: ReturnType<typeof vi.fn>
}

export const rfState: ReactFlowMockState = {
  nodes: [],
  edges: [],
  transform: [0, 0, 1],
  setViewport: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
}

export function resetReactFlowMockState() {
  rfState.nodes = []
  rfState.edges = []
  rfState.transform = [0, 0, 1]
  rfState.setViewport.mockReset()
  rfState.setNodes.mockReset()
  rfState.setEdges.mockReset()
}

export function createReactFlowModuleMock() {
  return {
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    MarkerType: { Arrow: 'arrow', ArrowClosed: 'arrowclosed' },
    ConnectionMode: { Strict: 'strict', Loose: 'loose' },

    useStoreApi: vi.fn(() => ({
      getState: () => ({
        getNodes: () => rfState.nodes,
        setNodes: rfState.setNodes,
        edges: rfState.edges,
        setEdges: rfState.setEdges,
        transform: rfState.transform,
        nodeInternals: new Map(),
        d3Selection: null,
        d3Zoom: null,
      }),
      setState: vi.fn(),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
    })),

    useReactFlow: vi.fn(() => ({
      setViewport: rfState.setViewport,
      setCenter: vi.fn(),
      fitView: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomTo: vi.fn(),
      getNodes: () => rfState.nodes,
      getEdges: () => rfState.edges,
      setNodes: rfState.setNodes,
      setEdges: rfState.setEdges,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      screenToFlowPosition: (pos: { x: number, y: number }) => pos,
      flowToScreenPosition: (pos: { x: number, y: number }) => pos,
      deleteElements: vi.fn(),
      addNodes: vi.fn(),
      addEdges: vi.fn(),
      getNode: vi.fn(),
      toObject: vi.fn().mockReturnValue({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),
      viewportInitialized: true,
    })),

    useStore: vi.fn().mockReturnValue(null),
    useNodes: vi.fn(() => rfState.nodes),
    useEdges: vi.fn(() => rfState.edges),
    useViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    useKeyPress: vi.fn(() => false),
    useOnSelectionChange: vi.fn(),
    useOnViewportChange: vi.fn(),
    useUpdateNodeInternals: vi.fn(() => vi.fn()),
    useNodeId: vi.fn(() => null),

    useNodesState: vi.fn((initial: unknown[] = []) => [initial, vi.fn(), vi.fn()]),
    useEdgesState: vi.fn((initial: unknown[] = []) => [initial, vi.fn(), vi.fn()]),

    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    ReactFlow: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'reactflow-mock' }, children),
    Background: () => null,
    MiniMap: () => null,
    Controls: () => null,
    Handle: (props: Record<string, unknown>) => React.createElement('div', props),
    BaseEdge: (props: Record<string, unknown>) => React.createElement('path', props),
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),

    getOutgoers: vi.fn().mockReturnValue([]),
    getIncomers: vi.fn().mockReturnValue([]),
    getConnectedEdges: vi.fn().mockReturnValue([]),
    isNode: vi.fn().mockReturnValue(true),
    isEdge: vi.fn().mockReturnValue(false),
    addEdge: vi.fn().mockImplementation((_e: unknown, edges: unknown[]) => edges),
    applyNodeChanges: vi.fn().mockImplementation((_c: unknown[], nodes: unknown[]) => nodes),
    applyEdgeChanges: vi.fn().mockImplementation((_c: unknown[], edges: unknown[]) => edges),
    getBezierPath: vi.fn().mockReturnValue(['M 0 0', 0, 0]),
    getSmoothStepPath: vi.fn().mockReturnValue(['M 0 0', 0, 0]),
    getStraightPath: vi.fn().mockReturnValue(['M 0 0', 0, 0]),
    internalsSymbol: Symbol('internals'),
  }
}

export type { MockEdge, MockNode, ReactFlowMockState }
