import { useCallback } from 'react'
import { produce } from 'immer'
import type {
  EdgeMouseHandler,
  OnEdgesChange,
} from 'reactflow'

import type {
  Node,
} from '../types'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { WorkflowHistoryEvent, useWorkflowHistory } from './use-workflow-history'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'

export const useEdgesInteractions = () => {
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => {
    if (getNodesReadOnly())
      return

    const { edges, setEdges } = collaborativeWorkflow.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data._hovering = true
    })
    setEdges(newEdges, false)
  }, [collaborativeWorkflow, getNodesReadOnly])

  const handleEdgeLeave = useCallback<EdgeMouseHandler>((_, edge) => {
    if (getNodesReadOnly())
      return

    const { edges, setEdges } = collaborativeWorkflow.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data._hovering = false
    })
    setEdges(newEdges, false)
  }, [collaborativeWorkflow, getNodesReadOnly])

  const handleEdgeDeleteByDeleteBranch = useCallback((nodeId: string, branchId: string) => {
    if (getNodesReadOnly())
      return

    const {
      nodes,
      setNodes,
      edges,
      setEdges,
    } = collaborativeWorkflow.getState()
    const edgeWillBeDeleted = edges.filter(edge => edge.source === nodeId && edge.sourceHandle === branchId)

    if (!edgeWillBeDeleted.length)
      return

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
  }, [getNodesReadOnly, collaborativeWorkflow, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgeDelete = useCallback(() => {
    if (getNodesReadOnly())
      return

    const {
      nodes,
      setNodes,
      edges,
      setEdges,
    } = collaborativeWorkflow.getState()
    const currentEdgeIndex = edges.findIndex(edge => edge.selected)

    if (currentEdgeIndex < 0)
      return
    const currentEdge = edges[currentEdgeIndex]
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
      draft.splice(currentEdgeIndex, 1)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
  }, [getNodesReadOnly, collaborativeWorkflow, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgesChange = useCallback<OnEdgesChange>((changes) => {
    if (getNodesReadOnly())
      return

    const {
      edges,
      setEdges,
    } = collaborativeWorkflow.getState()

    const newEdges = produce(edges, (draft) => {
      changes.forEach((change) => {
        if (change.type === 'select')
          draft.find(edge => edge.id === change.id)!.selected = change.selected
      })
    })
    setEdges(newEdges)
  }, [collaborativeWorkflow, getNodesReadOnly])

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDeleteByDeleteBranch,
    handleEdgeDelete,
    handleEdgesChange,
  }
}
