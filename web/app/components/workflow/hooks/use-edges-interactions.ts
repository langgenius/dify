import type {
  EdgeMouseHandler,
  OnEdgesChange,
} from 'reactflow'
import type {
  Node,
} from '../types'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { BlockEnum } from '../types'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-workflow-history'

export const useEdgesInteractions = () => {
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()

  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => {
    if (getNodesReadOnly())
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data._hovering = true
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  const handleEdgeLeave = useCallback<EdgeMouseHandler>((_, edge) => {
    if (getNodesReadOnly())
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data._hovering = false
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  const handleEdgeDeleteByDeleteBranch = useCallback((nodeId: string, branchId: string) => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const edgeWillBeDeleted = edges.filter(edge => edge.source === nodeId && edge.sourceHandle === branchId)

    if (!edgeWillBeDeleted.length)
      return

    const nodes = getNodes()
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      edgeWillBeDeleted.map(edge => ({ type: 'remove', edge })),
      nodes,
    )
    const newNodes = produce(nodes, (draft: Node[]) => {
      draft.forEach((node) => {
        if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
          node.data = {
            ...node.data,
            ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
          }
        }
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      return draft.filter(edge => !edgeWillBeDeleted.find(e => e.id === edge.id))
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDeleteByDeleteBranch)
  }, [getNodesReadOnly, store, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgeDelete = useCallback(() => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const currentEdgeIndex = edges.findIndex(edge => edge.selected)

    if (currentEdgeIndex < 0)
      return
    const currentEdge = edges[currentEdgeIndex]
    const nodes = getNodes()

    // collect edges to delete (including corresponding real edges for temp edges)
    const edgesToDelete: Set<string> = new Set([currentEdge.id])

    // if deleting a temp edge connected to a group, also delete the corresponding real hidden edge
    if (currentEdge.data?._isTemp) {
      const groupNode = nodes.find(n =>
        n.data.type === BlockEnum.Group
        && (n.id === currentEdge.source || n.id === currentEdge.target),
      )

      if (groupNode) {
        const memberIds = new Set((groupNode.data.members || []).map((m: { id: string }) => m.id))

        if (currentEdge.target === groupNode.id) {
          // inbound temp edge: find real edge with same source, target is a head node
          edges.forEach((edge) => {
            if (edge.source === currentEdge.source
              && memberIds.has(edge.target)
              && edge.sourceHandle === currentEdge.sourceHandle) {
              edgesToDelete.add(edge.id)
            }
          })
        }
        else if (currentEdge.source === groupNode.id) {
          // outbound temp edge: sourceHandle format is "leafNodeId-originalHandle"
          const sourceHandle = currentEdge.sourceHandle || ''
          const lastDashIndex = sourceHandle.lastIndexOf('-')
          if (lastDashIndex > 0) {
            const leafNodeId = sourceHandle.substring(0, lastDashIndex)
            const originalHandle = sourceHandle.substring(lastDashIndex + 1)

            edges.forEach((edge) => {
              if (edge.source === leafNodeId
                && edge.target === currentEdge.target
                && (edge.sourceHandle || 'source') === originalHandle) {
                edgesToDelete.add(edge.id)
              }
            })
          }
        }
      }
    }

    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        { type: 'remove', edge: currentEdge },
      ],
      nodes,
    )
    const newNodes = produce(nodes, (draft: Node[]) => {
      draft.forEach((node) => {
        if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
          node.data = {
            ...node.data,
            ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
          }
        }
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      for (let i = draft.length - 1; i >= 0; i--) {
        if (edgesToDelete.has(draft[i].id))
          draft.splice(i, 1)
      }
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
  }, [getNodesReadOnly, store, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgesChange = useCallback<OnEdgesChange>((changes) => {
    if (getNodesReadOnly())
      return

    const {
      edges,
      setEdges,
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      changes.forEach((change) => {
        if (change.type === 'select')
          draft.find(edge => edge.id === change.id)!.selected = change.selected
      })
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDeleteByDeleteBranch,
    handleEdgeDelete,
    handleEdgesChange,
  }
}
