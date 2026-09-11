import { act } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowUpdate } from '../use-workflow-update'

const mockEventEmit = vi.hoisted(() => vi.fn())
const mockInitialNodes = vi.hoisted(() => vi.fn((nodes: unknown[], _edges: unknown[]) => nodes))
const mockInitialEdges = vi.hoisted(() => vi.fn((edges: unknown[], _nodes: unknown[]) => edges))

vi.mock('reactflow', () => ({
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEventEmit(...args),
    },
  }),
}))

vi.mock('../../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils')>()),
  initialNodes: (nodes: unknown[], edges: unknown[]) => mockInitialNodes(nodes, edges),
  initialEdges: (edges: unknown[], nodes: unknown[]) => mockInitialEdges(edges, nodes),
}))

describe('useWorkflowUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes initialized data and a valid viewport in the same canvas update', () => {
    const { result } = renderWorkflowHook(() => useWorkflowUpdate())

    act(() => {
      result.current.handleUpdateWorkflowCanvas({
        nodes: [createNode({ id: 'n1' })],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 0.5 },
      } as never)
      result.current.handleUpdateWorkflowCanvas({
        nodes: [],
        edges: [],
        viewport: { x: 'bad' } as never,
      })
    })

    expect(mockInitialNodes).toHaveBeenCalled()
    expect(mockInitialEdges).toHaveBeenCalled()
    expect(mockEventEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WORKFLOW_DATA_UPDATE',
      }),
    )
    expect(mockEventEmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({ viewport: { x: 10, y: 20, zoom: 0.5 } }),
      }),
    )
    expect(mockEventEmit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({ viewport: undefined }),
      }),
    )
  })

  it('reports success only when the canvas acknowledges the update', () => {
    const { result } = renderWorkflowHook(() => useWorkflowUpdate())
    const graph = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    expect(result.current.handleUpdateWorkflowCanvas(graph)).toBe(false)
    mockEventEmit.mockImplementationOnce((event: { payload: { onApplied: () => void } }) => {
      event.payload.onApplied()
    })
    expect(result.current.handleUpdateWorkflowCanvas(graph)).toBe(true)
  })
})
