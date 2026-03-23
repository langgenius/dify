/**
 * ReactFlow mock factory for workflow tests.
 *
 * Usage — add this to the top of any test file that imports reactflow:
 *
 *   vi.mock('reactflow', async () => (await import('../__tests__/mock-reactflow')).createReactFlowMock())
 *
 * Or for more control:
 *
 *   vi.mock('reactflow', async () => {
 *     const base = (await import('../__tests__/mock-reactflow')).createReactFlowMock()
 *     return { ...base, useReactFlow: () => ({ ...base.useReactFlow(), fitView: vi.fn() }) }
 *   })
 */
import * as React from 'react'

export function createReactFlowMock(overrides: Record<string, unknown> = {}) {
  const noopComponent: React.FC<{ children?: React.ReactNode }> = ({ children }) =>
    React.createElement('div', { 'data-testid': 'reactflow-mock' }, children)
  noopComponent.displayName = 'ReactFlowMock'

  const backgroundComponent: React.FC = () => null
  backgroundComponent.displayName = 'BackgroundMock'

  return {
    // re-export the real Position enum
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    MarkerType: { Arrow: 'arrow', ArrowClosed: 'arrowclosed' },
    ConnectionMode: { Strict: 'strict', Loose: 'loose' },
    ConnectionLineType: { Bezier: 'default', Straight: 'straight', Step: 'step', SmoothStep: 'smoothstep' },

    // components
    default: noopComponent,
    ReactFlow: noopComponent,
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    Background: backgroundComponent,
    MiniMap: backgroundComponent,
    Controls: backgroundComponent,
    Handle: (props: Record<string, unknown>) => React.createElement('div', { 'data-testid': 'handle', ...props }),
    BaseEdge: (props: Record<string, unknown>) => React.createElement('path', props),
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),

    // hooks
    useReactFlow: () => ({
      setCenter: vi.fn(),
      fitView: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomTo: vi.fn(),
      getNodes: vi.fn().mockReturnValue([]),
      getEdges: vi.fn().mockReturnValue([]),
      getNode: vi.fn(),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      addNodes: vi.fn(),
      addEdges: vi.fn(),
      deleteElements: vi.fn(),
      getViewport: vi.fn().mockReturnValue({ x: 0, y: 0, zoom: 1 }),
      setViewport: vi.fn(),
      screenToFlowPosition: vi.fn().mockImplementation((pos: { x: number, y: number }) => pos),
      flowToScreenPosition: vi.fn().mockImplementation((pos: { x: number, y: number }) => pos),
      toObject: vi.fn().mockReturnValue({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),
      viewportInitialized: true,
    }),

    useStoreApi: () => ({
      getState: vi.fn().mockReturnValue({
        nodeInternals: new Map(),
        edges: [],
        transform: [0, 0, 1],
        d3Selection: null,
        d3Zoom: null,
      }),
      setState: vi.fn(),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
    }),

    useNodesState: vi.fn((initial: unknown[] = []) => [initial, vi.fn(), vi.fn()]),

    useEdgesState: vi.fn((initial: unknown[] = []) => [initial, vi.fn(), vi.fn()]),

    useStore: vi.fn().mockReturnValue(null),
    useNodes: vi.fn().mockReturnValue([]),
    useEdges: vi.fn().mockReturnValue([]),
    useViewport: vi.fn().mockReturnValue({ x: 0, y: 0, zoom: 1 }),
    useOnSelectionChange: vi.fn(),
    useKeyPress: vi.fn().mockReturnValue(false),
    useUpdateNodeInternals: vi.fn().mockReturnValue(vi.fn()),
    useOnViewportChange: vi.fn(),
    useNodeId: vi.fn().mockReturnValue(null),

    // utils
    getOutgoers: vi.fn().mockReturnValue([]),
    getIncomers: vi.fn().mockReturnValue([]),
    getConnectedEdges: vi.fn().mockReturnValue([]),
    isNode: vi.fn().mockReturnValue(true),
    isEdge: vi.fn().mockReturnValue(false),
    addEdge: vi.fn().mockImplementation((_edge: unknown, edges: unknown[]) => edges),
    applyNodeChanges: vi.fn().mockImplementation((_changes: unknown[], nodes: unknown[]) => nodes),
    applyEdgeChanges: vi.fn().mockImplementation((_changes: unknown[], edges: unknown[]) => edges),
    getBezierPath: vi.fn().mockReturnValue(['M 0 0', 0, 0]),
    getSmoothStepPath: vi.fn().mockReturnValue(['M 0 0', 0, 0]),
    getStraightPath: vi.fn().mockReturnValue(['M 0 0', 0, 0]),
    internalsSymbol: Symbol('internals'),

    ...overrides,
  }
}
