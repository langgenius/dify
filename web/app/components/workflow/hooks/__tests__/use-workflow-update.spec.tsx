import { act } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowUpdate } from '../use-workflow-update'

const mockSetViewport = vi.hoisted(() => vi.fn())
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
  useReactFlow: () => ({
    setViewport: mockSetViewport,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEventEmit(...args),
    },
  }),
}))

vi.mock('../../utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils')>()),
  initialNodes: (nodes: unknown[], edges: unknown[]) => mockInitialNodes(nodes, edges),
  initialEdges: (edges: unknown[], nodes: unknown[]) => mockInitialEdges(edges, nodes),
}))

describe('useWorkflowUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits initialized data and only sets a valid viewport', () => {
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
    expect(mockEventEmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'WORKFLOW_DATA_UPDATE',
    }))
    expect(mockSetViewport).toHaveBeenCalledTimes(1)
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 10, y: 20, zoom: 0.5 })
  })
})
