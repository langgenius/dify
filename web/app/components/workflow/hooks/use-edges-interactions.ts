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
import { useWorkflowStore } from '../store'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-workflow-history'

export const useEdgesInteractions = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()

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
    const currentEdgeMenu = workflowStore.getState().edgeMenu
    if (currentEdgeMenu && edgeWillBeDeleted.some(edge => edge.id === currentEdgeMenu.edgeId))
      workflowStore.setState({ edgeMenu: undefined })
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDeleteByDeleteBranch)
  }, [getNodesReadOnly, store, workflowStore, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgeDelete = useCallback(() => {
    if (getNodesReadOnly())
      return
    const { edges } = store.getState()
    const currentEdge = edges.find(edge => edge.selected)

    if (!currentEdge)
      return

    deleteEdgeById(currentEdge.id)
  }, [deleteEdgeById, getNodesReadOnly, store])

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
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      changes.forEach((change) => {
        if (change.type === 'select')
          draft.find(edge => edge.id === change.id)!.selected = change.selected
      })
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  const handleEdgeSourceHandleChange = useCallback((nodeId: string, oldHandleId: string, newHandleId: string) => {
    if (getNodesReadOnly())
      return

    const { getNodes, setNodes, edges, setEdges } = store.getState()
    const nodes = getNodes()

    // Find edges connected to the old handle
    const affectedEdges = edges.filter(
      edge => edge.source === nodeId && edge.sourceHandle === oldHandleId,
    )

    if (affectedEdges.length === 0)
      return

    // Update node metadata: remove old handle, add new handle
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        ...affectedEdges.map(edge => ({ type: 'remove', edge })),
        ...affectedEdges.map(edge => ({
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
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
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
  }, [getNodesReadOnly, store, workflowStore, handleSyncWorkflowDraft, saveStateToHistory])

  const handleEdgeContextMenu = useCallback<EdgeMouseHandler>((e, edge) => {
    if (getNodesReadOnly())
      return

    e.preventDefault()

    const { getNodes, setNodes, edges, setEdges } = store.getState()
    const newEdges = produce(edges, (draft) => {
      draft.forEach((item) => {
        item.selected = item.id === edge.id
        if (item.data._isBundled)
          item.data._isBundled = false
      })
    })
    setEdges(newEdges)
    const nodes = getNodes()
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
  }, [store, workflowStore, getNodesReadOnly])

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
