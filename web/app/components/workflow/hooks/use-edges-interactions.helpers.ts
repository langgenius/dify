import type { Edge, EdgeChange } from 'reactflow'
import type { Node } from '../types'
import { produce } from 'immer'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'

export const applyConnectedHandleNodeData = (
  nodes: Node[],
  edgeChanges: Parameters<typeof getNodesConnectedSourceOrTargetHandleIdsMap>[0],
) => {
  const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(edgeChanges, nodes)

  return produce(nodes, (draft: Node[]) => {
    draft.forEach((node) => {
      if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
        node.data = {
          ...node.data,
          ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
        }
      }
    })
  })
}

export const clearEdgeMenuIfNeeded = ({
  edgeMenu,
  edgeIds,
}: {
  edgeMenu?: {
    edgeId: string
  }
  edgeIds: string[]
}) => {
  return !!(edgeMenu && edgeIds.includes(edgeMenu.edgeId))
}

export const updateEdgeHoverState = (
  edges: Edge[],
  edgeId: string,
  hovering: boolean,
) => produce(edges, (draft) => {
  const currentEdge = draft.find(edge => edge.id === edgeId)
  if (currentEdge)
    currentEdge.data._hovering = hovering
})

export const updateEdgeSelectionState = (
  edges: Edge[],
  changes: EdgeChange[],
) => produce(edges, (draft) => {
  changes.forEach((change) => {
    if (change.type === 'select') {
      const currentEdge = draft.find(edge => edge.id === change.id)
      if (currentEdge)
        currentEdge.selected = change.selected
    }
  })
})

export const buildContextMenuEdges = (
  edges: Edge[],
  edgeId: string,
) => produce(edges, (draft) => {
  draft.forEach((item) => {
    item.selected = item.id === edgeId
    if (item.data._isBundled)
      item.data._isBundled = false
  })
})

export const clearNodeSelectionState = (nodes: Node[]) => produce(nodes, (draft: Node[]) => {
  draft.forEach((node) => {
    node.data.selected = false
    if (node.data._isBundled)
      node.data._isBundled = false
    node.selected = false
  })
})
