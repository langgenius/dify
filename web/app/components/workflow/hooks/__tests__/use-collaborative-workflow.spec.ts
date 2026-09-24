import type { Edge, Node } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

const mocks = vi.hoisted(() => ({
  canApplyLocalGraphMutation: vi.fn(),
  collabSetNodes: vi.fn(),
  collabSetEdges: vi.fn(),
  getNodes: vi.fn(),
  reactFlowSetNodes: vi.fn(),
  reactFlowSetEdges: vi.fn(),
  edges: [] as Edge[],
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mocks.getNodes,
      setNodes: mocks.reactFlowSetNodes,
      edges: mocks.edges,
      setEdges: mocks.reactFlowSetEdges,
    }),
  }),
}))

vi.mock('../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    canApplyLocalGraphMutation: mocks.canApplyLocalGraphMutation,
    setNodes: mocks.collabSetNodes,
    setEdges: mocks.collabSetEdges,
  },
}))

const oldNode = {
  id: 'old-node',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { title: 'Old' },
} as Node

const newNode = {
  ...oldNode,
  id: 'new-node',
  data: { title: 'New' },
} as Node

const oldEdge = {
  id: 'old-edge',
  source: 'old-node',
  target: 'new-node',
  data: {},
} as Edge

const newEdge = {
  ...oldEdge,
  id: 'new-edge',
} as Edge

describe('useCollaborativeWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getNodes.mockReturnValue([oldNode])
    mocks.edges = [oldEdge]
  })

  it('drops user graph mutations while collaborative state is not ready', () => {
    mocks.canApplyLocalGraphMutation.mockReturnValue(false)
    const { result } = renderHook(() => useCollaborativeWorkflow())

    act(() => {
      result.current.setNodes([newNode])
      result.current.setEdges([newEdge])
    })

    expect(mocks.collabSetNodes).not.toHaveBeenCalled()
    expect(mocks.collabSetEdges).not.toHaveBeenCalled()
    expect(mocks.reactFlowSetNodes).not.toHaveBeenCalled()
    expect(mocks.reactFlowSetEdges).not.toHaveBeenCalled()
  })

  it('still applies non-broadcast graph imports while collaborative state is not ready', () => {
    mocks.canApplyLocalGraphMutation.mockReturnValue(false)
    const { result } = renderHook(() => useCollaborativeWorkflow())

    act(() => {
      result.current.setNodes([newNode], false)
      result.current.setEdges([newEdge], false)
    })

    expect(mocks.collabSetNodes).not.toHaveBeenCalled()
    expect(mocks.collabSetEdges).not.toHaveBeenCalled()
    expect(mocks.reactFlowSetNodes).toHaveBeenCalledWith([newNode])
    expect(mocks.reactFlowSetEdges).toHaveBeenCalledWith([newEdge])
  })

  it('updates both CRDT and ReactFlow when collaborative state is ready', () => {
    mocks.canApplyLocalGraphMutation.mockReturnValue(true)
    const { result } = renderHook(() => useCollaborativeWorkflow())

    act(() => {
      result.current.setNodes([newNode])
      result.current.setEdges([newEdge])
    })

    expect(mocks.collabSetNodes).toHaveBeenCalledWith([oldNode], [newNode], expect.any(String))
    expect(mocks.collabSetEdges).toHaveBeenCalledWith([oldEdge], [newEdge])
    expect(mocks.reactFlowSetNodes).toHaveBeenCalledWith([newNode])
    expect(mocks.reactFlowSetEdges).toHaveBeenCalledWith([newEdge])
  })
})
