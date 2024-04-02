import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  OnEdgesChange,
} from 'reactflow'
import {
  getConnectedEdges,
  useStoreApi,
} from 'reactflow'
import type {
  Edge,
  Node,
} from '../types'
import { BlockEnum } from '../types'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'

export const useEdgesInteractions = () => {
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()

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
    const currentEdgeIndex = edges.findIndex(edge => edge.source === nodeId && edge.sourceHandle === branchId)

    if (currentEdgeIndex < 0)
      return

    const currentEdge = edges[currentEdgeIndex]
    const newNodes = produce(getNodes(), (draft: Node[]) => {
      const sourceNode = draft.find(node => node.id === currentEdge.source)
      const targetNode = draft.find(node => node.id === currentEdge.target)

      if (sourceNode)
        sourceNode.data._connectedSourceHandleIds = sourceNode.data._connectedSourceHandleIds?.filter(handleId => handleId !== currentEdge.sourceHandle)

      if (targetNode)
        targetNode.data._connectedTargetHandleIds = targetNode.data._connectedTargetHandleIds?.filter(handleId => handleId !== currentEdge.targetHandle)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.splice(currentEdgeIndex, 1)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft, getNodesReadOnly])

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
  }, [store, getNodesReadOnly, handleSyncWorkflowDraft])

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

  const handleVariableAssignerEdgesChange = useCallback((nodeId: string, variables: any) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const newEdgesTargetHandleIds = variables.map((item: any) => item[0])
    const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges).filter(edge => edge.target === nodeId)
    const needDeleteEdges = connectedEdges.filter(edge => !newEdgesTargetHandleIds.includes(edge.targetHandle))
    const needAddEdgesTargetHandleIds = newEdgesTargetHandleIds.filter((targetHandle: string) => !connectedEdges.some(edge => edge.targetHandle === targetHandle))
    const needAddEdges = needAddEdgesTargetHandleIds.map((targetHandle: string) => {
      return {
        id: `${targetHandle}-${nodeId}`,
        type: 'custom',
        source: targetHandle,
        sourceHandle: 'source',
        target: nodeId,
        targetHandle,
        data: {
          sourceType: nodes.find(node => node.id === targetHandle)?.data.type,
          targetType: BlockEnum.VariableAssigner,
        },
      }
    })

    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        ...needDeleteEdges.map(edge => ({ type: 'remove', edge })),
        ...needAddEdges.map((edge: Edge) => ({ type: 'add', edge })),
      ],
      nodes,
    )
    const newNodes = produce(nodes, (draft) => {
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
      const filtered = draft.filter(edge => !needDeleteEdges.map(needDeleteEdge => needDeleteEdge.id).includes(edge.id))

      filtered.push(...needAddEdges)

      return filtered
    })
    setEdges(newEdges)
  }, [store])

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDeleteByDeleteBranch,
    handleEdgeDelete,
    handleEdgesChange,
    handleVariableAssignerEdgesChange,
  }
}
