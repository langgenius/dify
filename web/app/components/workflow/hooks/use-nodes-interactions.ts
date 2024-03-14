import { useCallback, useRef } from 'react'
import produce from 'immer'
import type {
  NodeDragHandler,
  NodeMouseHandler,
  OnConnect,
} from 'reactflow'
import {
  getConnectedEdges,
  getOutgoers,
  useStoreApi,
} from 'reactflow'
import type { ToolDefaultValue } from '../block-selector/types'
import type {
  Node,
  OnNodeAdd,
} from '../types'
import { BlockEnum } from '../types'
import { useStore } from '../store'
import {
  NODE_WIDTH_X_OFFSET,
  Y_OFFSET,
} from '../constants'
import {
  generateNewNode,
  getNodesConnectedSourceOrTargetHandleIdsMap,
} from '../utils'
import { useNodesInitialData } from './use-nodes-data'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useWorkflow } from './use-workflow'

export const useNodesInteractions = () => {
  const store = useStoreApi()
  const nodesInitialData = useNodesInitialData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getAfterNodesInSameBranch } = useWorkflow()
  const dragNodeStartPosition = useRef({ x: 0, y: 0 } as { x: number; y: number })

  const handleNodeDragStart = useCallback<NodeDragHandler>((_, node) => {
    const {
      runningStatus,
    } = useStore.getState()

    if (runningStatus)
      return

    dragNodeStartPosition.current = { x: node.position.x, y: node.position.y }
  }, [])

  const handleNodeDrag = useCallback<NodeDragHandler>((e, node: Node) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()
    const {
      setHelpLineHorizontal,
      setHelpLineVertical,
    } = useStore.getState()
    e.stopPropagation()

    const nodes = getNodes()

    const showHorizontalHelpLineNodes = nodes.filter((n) => {
      if (n.id === node.id)
        return false

      const nY = Math.ceil(n.position.y)
      const nodeY = Math.ceil(node.position.y)

      if (nY - nodeY < 5 && nY - nodeY > -5)
        return true

      return false
    }).sort((a, b) => a.position.x - b.position.x)
    const showHorizontalHelpLineNodesLength = showHorizontalHelpLineNodes.length
    if (showHorizontalHelpLineNodesLength > 0) {
      const first = showHorizontalHelpLineNodes[0]
      const last = showHorizontalHelpLineNodes[showHorizontalHelpLineNodesLength - 1]

      const helpLine = {
        top: first.position.y,
        left: first.position.x,
        width: last.position.x + last.width! - first.position.x,
      }

      if (node.position.x < first.position.x) {
        helpLine.left = node.position.x
        helpLine.width = first.position.x + first.width! - node.position.x
      }

      if (node.position.x > last.position.x)
        helpLine.width = node.position.x + node.width! - first.position.x

      setHelpLineHorizontal(helpLine)
    }
    else {
      setHelpLineHorizontal()
    }

    const showVerticalHelpLineNodes = nodes.filter((n) => {
      if (n.id === node.id)
        return false

      const nX = Math.ceil(n.position.x)
      const nodeX = Math.ceil(node.position.x)

      if (nX - nodeX < 5 && nX - nodeX > -5)
        return true

      return false
    }).sort((a, b) => a.position.x - b.position.x)
    const showVerticalHelpLineNodesLength = showVerticalHelpLineNodes.length

    if (showVerticalHelpLineNodesLength > 0) {
      const first = showVerticalHelpLineNodes[0]
      const last = showVerticalHelpLineNodes[showVerticalHelpLineNodesLength - 1]

      const helpLine = {
        top: first.position.y,
        left: first.position.x,
        height: last.position.y + last.height! - first.position.y,
      }

      if (node.position.y < first.position.y) {
        helpLine.top = node.position.y
        helpLine.height = first.position.y + first.height! - node.position.y
      }

      if (node.position.y > last.position.y)
        helpLine.height = node.position.y + node.height! - first.position.y

      setHelpLineVertical(helpLine)
    }
    else {
      setHelpLineVertical()
    }

    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(n => n.id === node.id)!

      currentNode.position = {
        x: showVerticalHelpLineNodesLength > 0 ? showVerticalHelpLineNodes[0].position.x : node.position.x,
        y: showHorizontalHelpLineNodesLength > 0 ? showHorizontalHelpLineNodes[0].position.y : node.position.y,
      }
    })

    setNodes(newNodes)
  }, [store])

  const handleNodeDragStop = useCallback<NodeDragHandler>((_, node) => {
    const {
      runningStatus,
      setHelpLineHorizontal,
      setHelpLineVertical,
    } = useStore.getState()

    if (runningStatus)
      return

    const { x, y } = dragNodeStartPosition.current
    if (!(x === node.position.x && y === node.position.y)) {
      setHelpLineHorizontal()
      setHelpLineVertical()
      handleSyncWorkflowDraft()
    }
  }, [handleSyncWorkflowDraft])

  const handleNodeEnter = useCallback<NodeMouseHandler>((_, node) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const connectedEdges = getConnectedEdges([node], edges)

      connectedEdges.forEach((edge) => {
        const currentEdge = draft.find(e => e.id === edge.id)
        if (currentEdge)
          currentEdge.data = { ...currentEdge.data, _connectedNodeIsHovering: true }
      })
    })
    setEdges(newEdges)
  }, [store])

  const handleNodeLeave = useCallback<NodeMouseHandler>(() => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.data = { ...edge.data, _connectedNodeIsHovering: false }
      })
    })
    setEdges(newEdges)
  }, [store])

  const handleNodeSelect = useCallback((nodeId: string, cancelSelection?: boolean) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const selectedNode = nodes.find(node => node.data.selected)

    if (!cancelSelection && selectedNode?.id === nodeId)
      return

    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (node.id === nodeId)
          node.data.selected = !cancelSelection
        else
          node.data.selected = false
      })
    })
    setNodes(newNodes)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    const {
      runningStatus,
    } = useStore.getState()

    if (runningStatus)
      return

    handleNodeSelect(node.id)
  }, [handleNodeSelect])

  const handleNodeConnect = useCallback<OnConnect>(({
    source,
    sourceHandle,
    target,
    targetHandle,
  }) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const needDeleteEdges = edges.filter(edge => (edge.source === source && edge.sourceHandle === sourceHandle) || (edge.target === target && edge.targetHandle === targetHandle))
    const needDeleteEdgesIds = needDeleteEdges.map(edge => edge.id)
    const newEdge = {
      id: `${source}-${target}`,
      type: 'custom',
      source: source!,
      target: target!,
      sourceHandle,
      targetHandle,
    }
    const nodes = getNodes()
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        ...needDeleteEdges.map(edge => ({ type: 'remove', edge })),
        { type: 'add', edge: newEdge },
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
      const filtered = draft.filter(edge => !needDeleteEdgesIds.includes(edge.id))

      filtered.push(newEdge)

      return filtered
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleNodeDelete = useCallback((nodeId: string) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()

    const nodes = getNodes()
    const currentNodeIndex = nodes.findIndex(node => node.id === nodeId)
    const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges)
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(connectedEdges.map(edge => ({ type: 'remove', edge })), nodes)
    const newNodes = produce(nodes, (draft: Node[]) => {
      draft.forEach((node) => {
        if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
          node.data = {
            ...node.data,
            ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
          }
        }
      })
      draft.splice(currentNodeIndex, 1)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      return draft.filter(edge => !connectedEdges.find(connectedEdge => connectedEdge.id === edge.id))
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleNodeAdd = useCallback<OnNodeAdd>((
    {
      nodeType,
      sourceHandle = 'source',
      targetHandle = 'target',
      toolDefaultValue,
    },
    {
      prevNodeId,
      prevNodeSourceHandle,
      nextNodeId,
      nextNodeTargetHandle,
    },
  ) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    if (nodeType === BlockEnum.VariableAssigner)
      targetHandle = 'varNotSet'

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const nodesWithSameType = nodes.filter(node => node.data.type === nodeType)
    const newNode = generateNewNode({
      data: {
        ...nodesInitialData[nodeType],
        title: nodesWithSameType.length > 0 ? `${nodesInitialData[nodeType].title} ${nodesWithSameType.length + 1}` : nodesInitialData[nodeType].title,
        ...(toolDefaultValue || {}),
        selected: true,
      },
      position: {
        x: 0,
        y: 0,
      },
    })
    if (prevNodeId && !nextNodeId) {
      const prevNodeIndex = nodes.findIndex(node => node.id === prevNodeId)
      const prevNode = nodes[prevNodeIndex]
      const outgoers = getOutgoers(prevNode, nodes, edges).sort((a, b) => a.position.y - b.position.y)
      const lastOutgoer = outgoers[outgoers.length - 1]
      newNode.data._connectedTargetHandleIds = [targetHandle]
      newNode.data._connectedSourceHandleIds = []
      newNode.position = {
        x: lastOutgoer ? lastOutgoer.position.x : prevNode.position.x + NODE_WIDTH_X_OFFSET,
        y: lastOutgoer ? lastOutgoer.position.y + lastOutgoer.height! + Y_OFFSET : prevNode.position.y,
      }

      const newEdge = {
        id: `${prevNodeId}-${newNode.id}`,
        type: 'custom',
        source: prevNodeId,
        sourceHandle: prevNodeSourceHandle,
        target: newNode.id,
        targetHandle,
      }
      const newNodes = produce(nodes, (draft: Node[]) => {
        draft.forEach((node) => {
          node.data.selected = false

          if (node.id === prevNode.id)
            node.data._connectedSourceHandleIds?.push(prevNodeSourceHandle!)
        })
        draft.push(newNode)
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.push(newEdge)
      })
      setEdges(newEdges)
    }
    if (!prevNodeId && nextNodeId) {
      const nextNodeIndex = nodes.findIndex(node => node.id === nextNodeId)
      const nextNode = nodes[nextNodeIndex]!
      newNode.data._connectedSourceHandleIds = [sourceHandle]
      newNode.data._connectedTargetHandleIds = []
      newNode.position = {
        x: nextNode.position.x,
        y: nextNode.position.y,
      }

      const newEdge = {
        id: `${newNode.id}-${nextNodeId}`,
        type: 'custom',
        source: newNode.id,
        sourceHandle,
        target: nextNodeId,
        targetHandle: nextNodeTargetHandle,
      }
      const afterNodesInSameBranch = getAfterNodesInSameBranch(nextNodeId!)
      const afterNodesInSameBranchIds = afterNodesInSameBranch.map(node => node.id)
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          node.data.selected = false

          if (afterNodesInSameBranchIds.includes(node.id))
            node.position.x += NODE_WIDTH_X_OFFSET

          if (node.id === nextNodeId)
            node.data._connectedTargetHandleIds?.push(nextNodeTargetHandle!)
        })
        draft.push(newNode)
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.push(newEdge)
      })
      setEdges(newEdges)
    }
    if (prevNodeId && nextNodeId) {
      const nextNode = nodes.find(node => node.id === nextNodeId)!
      newNode.data._connectedTargetHandleIds = [targetHandle]
      newNode.data._connectedSourceHandleIds = [sourceHandle]
      newNode.position = {
        x: nextNode.position.x,
        y: nextNode.position.y,
      }

      const currentEdgeIndex = edges.findIndex(edge => edge.source === prevNodeId && edge.target === nextNodeId)
      const newPrevEdge = {
        id: `${prevNodeId}-${newNode.id}`,
        type: 'custom',
        source: prevNodeId,
        sourceHandle: prevNodeSourceHandle,
        target: newNode.id,
        targetHandle,
      }
      const newNextEdge = {
        id: `${newNode.id}-${nextNodeId}`,
        type: 'custom',
        source: newNode.id,
        sourceHandle,
        target: nextNodeId,
        targetHandle: nextNodeTargetHandle,
      }
      const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        [
          { type: 'remove', edge: edges[currentEdgeIndex] },
          { type: 'add', edge: newPrevEdge },
          { type: 'add', edge: newNextEdge },
        ],
        nodes,
      )

      const afterNodesInSameBranch = getAfterNodesInSameBranch(nextNodeId!)
      const afterNodesInSameBranchIds = afterNodesInSameBranch.map(node => node.id)
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          node.data.selected = false

          if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
            node.data = {
              ...node.data,
              ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
            }
          }
          if (afterNodesInSameBranchIds.includes(node.id))
            node.position.x += NODE_WIDTH_X_OFFSET
        })
        draft.push(newNode)
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.splice(currentEdgeIndex, 1)
        draft.push(newPrevEdge)
        draft.push(newNextEdge)
      })
      setEdges(newEdges)
    }
    handleSyncWorkflowDraft()
  }, [store, nodesInitialData, handleSyncWorkflowDraft, getAfterNodesInSameBranch])

  const handleNodeChange = useCallback((
    currentNodeId: string,
    nodeType: BlockEnum,
    sourceHandle: string,
    toolDefaultValue?: ToolDefaultValue,
  ) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === currentNodeId)!
    const connectedEdges = getConnectedEdges([currentNode], edges)
    const nodesWithSameType = nodes.filter(node => node.data.type === nodeType)
    const newCurrentNode = generateNewNode({
      data: {
        ...nodesInitialData[nodeType],
        title: nodesWithSameType.length > 0 ? `${nodesInitialData[nodeType].title} ${nodesWithSameType.length + 1}` : nodesInitialData[nodeType].title,
        ...(toolDefaultValue || {}),
        _connectedSourceHandleIds: [],
        _connectedTargetHandleIds: [],
        selected: currentNode.data.selected,
      },
      position: {
        x: currentNode.position.x,
        y: currentNode.position.y,
      },
    })
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        ...connectedEdges.map(edge => ({ type: 'remove', edge })),
      ],
      nodes,
    )
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data.selected = false

        if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
          node.data = {
            ...node.data,
            ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
          }
        }
      })
      const index = draft.findIndex(node => node.id === currentNodeId)

      draft.splice(index, 1, newCurrentNode)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const filtered = draft.filter(edge => !connectedEdges.find(connectedEdge => connectedEdge.id === edge.id))

      return filtered
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, nodesInitialData, handleSyncWorkflowDraft])

  return {
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleNodeEnter,
    handleNodeLeave,
    handleNodeSelect,
    handleNodeClick,
    handleNodeConnect,
    handleNodeDelete,
    handleNodeChange,
    handleNodeAdd,
  }
}
