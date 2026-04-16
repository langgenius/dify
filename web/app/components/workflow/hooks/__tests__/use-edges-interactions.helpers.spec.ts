import { createEdge, createNode } from '../../__tests__/fixtures'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../../utils'
import {
  applyConnectedHandleNodeData,
  buildContextMenuEdges,
  clearEdgeMenuIfNeeded,
  clearNodeSelectionState,
  updateEdgeHoverState,
  updateEdgeSelectionState,
} from '../use-edges-interactions.helpers'

vi.mock('../../utils', () => ({
  getNodesConnectedSourceOrTargetHandleIdsMap: vi.fn(),
}))

const mockGetNodesConnectedSourceOrTargetHandleIdsMap = vi.mocked(getNodesConnectedSourceOrTargetHandleIdsMap)

describe('use-edges-interactions.helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applyConnectedHandleNodeData should merge connected handle metadata into matching nodes', () => {
    mockGetNodesConnectedSourceOrTargetHandleIdsMap.mockReturnValue({
      'node-1': {
        _connectedSourceHandleIds: ['branch-a'],
      },
    })

    const nodes = [
      createNode({ id: 'node-1', data: { title: 'Source' } }),
      createNode({ id: 'node-2', data: { title: 'Target' } }),
    ]
    const edgeChanges = [{
      type: 'add',
      edge: createEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' }),
    }]

    const result = applyConnectedHandleNodeData(nodes, edgeChanges)

    expect(result[0]!.data._connectedSourceHandleIds).toEqual(['branch-a'])
    expect(result[1]!.data._connectedSourceHandleIds).toEqual([])
    expect(mockGetNodesConnectedSourceOrTargetHandleIdsMap).toHaveBeenCalledWith(edgeChanges, nodes)
  })

  it('clearEdgeMenuIfNeeded should return true only when the open menu belongs to a removed edge', () => {
    expect(clearEdgeMenuIfNeeded({
      edgeMenu: { edgeId: 'edge-1' },
      edgeIds: ['edge-1', 'edge-2'],
    })).toBe(true)

    expect(clearEdgeMenuIfNeeded({
      edgeMenu: { edgeId: 'edge-3' },
      edgeIds: ['edge-1', 'edge-2'],
    })).toBe(false)

    expect(clearEdgeMenuIfNeeded({
      edgeIds: ['edge-1'],
    })).toBe(false)
  })

  it('updateEdgeHoverState should toggle only the hovered edge flag', () => {
    const edges = [
      createEdge({ id: 'edge-1', data: { _hovering: false } }),
      createEdge({ id: 'edge-2', data: { _hovering: false } }),
    ]

    const result = updateEdgeHoverState(edges, 'edge-2', true)

    expect(result.find(edge => edge.id === 'edge-1')?.data._hovering).toBe(false)
    expect(result.find(edge => edge.id === 'edge-2')?.data._hovering).toBe(true)
  })

  it('updateEdgeSelectionState should update selected flags for select changes only', () => {
    const edges = [
      createEdge({ id: 'edge-1', selected: false }),
      createEdge({ id: 'edge-2', selected: true }),
    ]

    const result = updateEdgeSelectionState(edges, [
      { type: 'select', id: 'edge-1', selected: true },
      { type: 'remove', id: 'edge-2' },
    ])

    expect(result.find(edge => edge.id === 'edge-1')?.selected).toBe(true)
    expect(result.find(edge => edge.id === 'edge-2')?.selected).toBe(true)
  })

  it('buildContextMenuEdges should select the target edge and clear bundled markers', () => {
    const edges = [
      createEdge({ id: 'edge-1', selected: true, data: { _isBundled: true } }),
      createEdge({ id: 'edge-2', selected: false, data: { _isBundled: true } }),
    ]

    const result = buildContextMenuEdges(edges, 'edge-2')

    expect(result.find(edge => edge.id === 'edge-1')?.selected).toBe(false)
    expect(result.find(edge => edge.id === 'edge-2')?.selected).toBe(true)
    expect(result.every(edge => edge.data._isBundled === false)).toBe(true)
  })

  it('clearNodeSelectionState should clear selected state and bundled markers on every node', () => {
    const nodes = [
      createNode({ id: 'node-1', selected: true, data: { selected: true, _isBundled: true } }),
      createNode({ id: 'node-2', selected: false, data: { selected: true, _isBundled: true } }),
    ]

    const result = clearNodeSelectionState(nodes)

    expect(result.every(node => node.selected === false)).toBe(true)
    expect(result.every(node => node.data.selected === false)).toBe(true)
    expect(result.every(node => node.data._isBundled === false)).toBe(true)
  })
})
