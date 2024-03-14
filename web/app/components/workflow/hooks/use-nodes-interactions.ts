import { useCallback, useRef } from 'react'
import produce from 'immer'
import type {
  NodeDragHandler,
  NodeMouseHandler,
  OnConnect,
} from 'reactflow'
import {
  Position,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
  useStoreApi,
} from 'reactflow'
import type { ToolDefaultValue } from '../block-selector/types'
import type {
  Node,
} from '../types'
import { BlockEnum } from '../types'
import { useStore } from '../store'
import {
  NODE_WIDTH_X_OFFSET,
  Y_OFFSET,
} from '../constants'
import { useNodesInitialData } from './use-nodes-data'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

export const useNodesInteractions = () => {
  const store = useStoreApi()
  const nodesInitialData = useNodesInitialData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
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
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const filtered = draft.filter(edge => (edge.source !== source && edge.sourceHandle !== sourceHandle) || (edge.target !== target && edge.targetHandle !== targetHandle))

      filtered.push({
        id: `${source}-${target}`,
        type: 'custom',
        source: source!,
        target: target!,
        sourceHandle,
        targetHandle,
      })

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
    const currentNode = nodes[currentNodeIndex]
    const incomersIds = getIncomers(currentNode, nodes, edges).map(incomer => incomer.id)
    const outgoersIds = getOutgoers(currentNode, nodes, edges).map(outgoer => outgoer.id)
    const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges)
    const sourceEdgesHandleIds = connectedEdges.filter(edge => edge.target === nodeId).map(edge => edge.sourceHandle)
    const targetEdgesHandleIds = connectedEdges.filter(edge => edge.source === nodeId).map(edge => edge.targetHandle)
    const newNodes = produce(nodes, (draft: Node[]) => {
      draft.forEach((node) => {
        if (incomersIds.includes(node.id))
          node.data._connectedSourceHandleIds = node.data._connectedSourceHandleIds?.filter(handleId => !sourceEdgesHandleIds.includes(handleId))

        if (outgoersIds.includes(node.id))
          node.data._connectedTargetHandleIds = node.data._connectedTargetHandleIds?.filter(handleId => !targetEdgesHandleIds.includes(handleId))
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

  const handleNodeAddNext = useCallback((
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
    const currentNodeIndex = nodes.findIndex(node => node.id === currentNodeId)
    const currentNode = nodes[currentNodeIndex]
    const outgoers = getOutgoers(currentNode, nodes, edges).sort((a, b) => a.position.y - b.position.y)
    const lastOutgoer = outgoers[outgoers.length - 1]
    const nextNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: {
        ...nodesInitialData[nodeType],
        ...(toolDefaultValue || {}),
        _connectedTargetHandleIds: ['target'],
        selected: true,
      },
      position: {
        x: lastOutgoer ? lastOutgoer.position.x : currentNode.position.x + NODE_WIDTH_X_OFFSET,
        y: lastOutgoer ? lastOutgoer.position.y + lastOutgoer.height! + Y_OFFSET : currentNode.position.y,
      },
      targetPosition: Position.Left,
    }
    const newEdge = {
      id: `${currentNode.id}-${nextNode.id}`,
      type: 'custom',
      source: currentNode.id,
      sourceHandle,
      target: nextNode.id,
      targetHandle: 'target',
    }
    const newNodes = produce(nodes, (draft: Node[]) => {
      draft.forEach((node, index) => {
        node.data.selected = false

        if (index === currentNodeIndex)
          node.data._connectedSourceHandleIds?.push(sourceHandle)
      })
      draft.push(nextNode)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.push(newEdge)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, nodesInitialData, handleSyncWorkflowDraft])

  const handleNodeAddPrev = useCallback((
    currentNodeId: string,
    nodeType: BlockEnum,
    targetHandle: string,
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
    const currentNodeIndex = nodes.findIndex(node => node.id === currentNodeId)
    const currentNode = nodes[currentNodeIndex]
    const prevNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: {
        ...nodesInitialData[nodeType],
        ...(toolDefaultValue || {}),
        selected: true,
      },
      position: {
        x: currentNode.position.x,
        y: currentNode.position.y,
      },
      targetPosition: Position.Left,
    }
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node, index) => {
        node.data.selected = false

        if (index === currentNodeIndex)
          node.position.x += NODE_WIDTH_X_OFFSET
      })
      draft.push(prevNode)
    })
    setNodes(newNodes)

    if (prevNode.type !== BlockEnum.IfElse && prevNode.type !== BlockEnum.QuestionClassifier) {
      const newEdge = {
        id: `${prevNode.id}-${currentNode.id}`,
        type: 'custom',
        source: prevNode.id,
        sourceHandle: 'source',
        target: currentNode.id,
        targetHandle,
      }
      const newEdges = produce(edges, (draft) => {
        draft.push(newEdge)
      })
      setEdges(newEdges)
    }

    handleSyncWorkflowDraft()
  }, [store, nodesInitialData, handleSyncWorkflowDraft])

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
    const incomers = getIncomers(currentNode, nodes, edges)
    const connectedEdges = getConnectedEdges([currentNode], edges)
    const newCurrentNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: {
        ...nodesInitialData[nodeType],
        ...(toolDefaultValue || {}),
        selected: currentNode.data.selected,
      },
      position: {
        x: currentNode.position.x,
        y: currentNode.position.y,
      },
      targetPosition: Position.Left,
    }
    const newNodes = produce(nodes, (draft) => {
      const index = draft.findIndex(node => node.id === currentNodeId)

      draft.splice(index, 1, newCurrentNode)
    })
    setNodes(newNodes)
    if (incomers.length === 1) {
      const parentNodeId = incomers[0].id

      const newEdge = {
        id: `${parentNodeId}-${newCurrentNode.id}`,
        type: 'custom',
        source: parentNodeId,
        sourceHandle,
        target: newCurrentNode.id,
        targetHandle: 'target',
      }

      const newEdges = produce(edges, (draft) => {
        const filtered = draft.filter(edge => !connectedEdges.find(connectedEdge => connectedEdge.id === edge.id))
        filtered.push(newEdge)

        return filtered
      })
      setEdges(newEdges)
      handleSyncWorkflowDraft()
    }
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
    handleNodeAddNext,
    handleNodeAddPrev,
    handleNodeChange,
  }
}
