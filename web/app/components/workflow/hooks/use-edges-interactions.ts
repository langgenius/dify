import type {
  Edge,
  EdgeMouseHandler,
  OnEdgesChange,
} from 'reactflow'
import type {
  Node,
} from '../types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-workflow-history'

export const useEdgesInteractions = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const deleteEdgeById = useCallback((edgeId: string) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const currentEdgeIndex = edges.findIndex(edge => edge.id === edgeId)

    if (currentEdgeIndex < 0)
      return
    const currentEdge = edges[currentEdgeIndex]
    const nodes = getNodes()
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
    const currentEdgeMenu = workflowStore.getState().edgeMenu
    if (currentEdgeMenu?.edgeId === currentEdge.id)
      workflowStore.setState({ edgeMenu: undefined })
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
  }, [store, workflowStore, handleSyncWorkflowDraft, saveStateToHistory])

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
    const currentEdgeMenu = workflowStore.getState().edgeMenu
    if (currentEdgeMenu && edgeWillBeDeleted.some(edge => edge.id === currentEdgeMenu.edgeId))
      workflowStore.setState({ edgeMenu: undefined })
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDeleteByDeleteBranch)
  }, [getNodesReadOnly, collaborativeWorkflow, workflowStore, handleSyncWorkflowDraft, saveStateToHistory])

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
      for (let i = draft.length - 1; i >= 0; i--) {
        if (draft[i].id === currentEdge.id)
          draft.splice(i, 1)
      }
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
  }, [getNodesReadOnly, collaborativeWorkflow, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgeDeleteById = useCallback((edgeId: string) => {
    if (getNodesReadOnly())
      return

    deleteEdgeById(edgeId)
  }, [deleteEdgeById, getNodesReadOnly])

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

  const handleEdgeSourceHandleChange = useCallback((nodeId: string, oldHandleId: string, newHandleId: string) => {
    if (getNodesReadOnly())
      return

    const {
      nodes,
      setNodes,
      edges,
      setEdges,
    } = collaborativeWorkflow.getState()

    // Find edges connected to the old handle
    const affectedEdges = edges.filter(
      (edge: Edge) => edge.source === nodeId && edge.sourceHandle === oldHandleId,
    )

    if (affectedEdges.length === 0)
      return

    // Update node metadata: remove old handle, add new handle
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        ...affectedEdges.map((edge: Edge) => ({ type: 'remove', edge })),
        ...affectedEdges.map((edge: Edge) => ({
          type: 'add',
          edge: { ...edge, sourceHandle: newHandleId },
        })),
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

    // Update edges to use new sourceHandle and regenerate edge IDs
    const newEdges = produce(edges, (draft: Edge[]) => {
      draft.forEach((edge: Edge) => {
        if (edge.source === nodeId && edge.sourceHandle === oldHandleId) {
          edge.sourceHandle = newHandleId
          edge.id = `${edge.source}-${newHandleId}-${edge.target}-${edge.targetHandle}`
        }
      })
    })
    setEdges(newEdges)
    const currentEdgeMenu = workflowStore.getState().edgeMenu
    if (currentEdgeMenu && !newEdges.some(edge => edge.id === currentEdgeMenu.edgeId))
      workflowStore.setState({ edgeMenu: undefined })
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeSourceHandleChange)
  }, [getNodesReadOnly, collaborativeWorkflow, workflowStore, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgeContextMenu = useCallback<EdgeMouseHandler>((e, edge) => {
    if (getNodesReadOnly())
      return

    e.preventDefault()

    const { nodes, setNodes, edges, setEdges } = collaborativeWorkflow.getState()
    const newEdges = produce(edges, (draft) => {
      draft.forEach((item) => {
        item.selected = item.id === edge.id
        if (item.data._isBundled)
          item.data._isBundled = false
      })
    })
    setEdges(newEdges)
    if (nodes.some(node => node.data.selected || node.selected || node.data._isBundled)) {
      const newNodes = produce(nodes, (draft: Node[]) => {
        draft.forEach((node) => {
          node.data.selected = false
          if (node.data._isBundled)
            node.data._isBundled = false
          node.selected = false
        })
      })
      setNodes(newNodes)
    }

    workflowStore.setState({
      nodeMenu: undefined,
      panelMenu: undefined,
      selectionMenu: undefined,
      edgeMenu: {
        clientX: e.clientX,
        clientY: e.clientY,
        edgeId: edge.id,
      },
    })
  }, [collaborativeWorkflow, workflowStore, getNodesReadOnly])

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDeleteByDeleteBranch,
    handleEdgeDelete,
    handleEdgeDeleteById,
    handleEdgesChange,
    handleEdgeSourceHandleChange,
    handleEdgeContextMenu,
  }
}
