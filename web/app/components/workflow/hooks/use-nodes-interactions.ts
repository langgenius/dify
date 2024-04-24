import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type {
  HandleType,
  NodeDragHandler,
  NodeMouseHandler,
  OnConnect,
  OnConnectStart,
} from 'reactflow'
import {
  getConnectedEdges,
  getOutgoers,
  useStoreApi,
} from 'reactflow'
import type { ToolDefaultValue } from '../block-selector/types'
import type {
  Edge,
  Node,
  OnNodeAdd,
} from '../types'
import { BlockEnum } from '../types'
import { useWorkflowStore } from '../store'
import {
  NODES_INITIAL_DATA,
  NODE_WIDTH_X_OFFSET,
  Y_OFFSET,
} from '../constants'
import {
  generateNewNode,
  getNodesConnectedSourceOrTargetHandleIdsMap,
} from '../utils'
import { useNodesExtraData } from './use-nodes-data'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import {
  useNodesReadOnly,
  useWorkflow,
} from './use-workflow'

export const useNodesInteractions = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const nodesExtraData = useNodesExtraData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    getAfterNodesInSameBranch,
    getTreeLeafNodes,
  } = useWorkflow()
  const { getNodesReadOnly } = useNodesReadOnly()
  const dragNodeStartPosition = useRef({ x: 0, y: 0 } as { x: number; y: number })
  const connectingNodeRef = useRef<{ nodeId: string; handleType: HandleType } | null>(null)

  const handleNodeDragStart = useCallback<NodeDragHandler>((_, node) => {
    workflowStore.setState({ nodeAnimation: false })

    if (getNodesReadOnly())
      return

    dragNodeStartPosition.current = { x: node.position.x, y: node.position.y }
  }, [workflowStore, getNodesReadOnly])

  const handleNodeDrag = useCallback<NodeDragHandler>((e, node: Node) => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()
    const {
      setHelpLineHorizontal,
      setHelpLineVertical,
    } = workflowStore.getState()
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
  }, [store, workflowStore, getNodesReadOnly])

  const handleNodeDragStop = useCallback<NodeDragHandler>((_, node) => {
    const {
      setHelpLineHorizontal,
      setHelpLineVertical,
    } = workflowStore.getState()

    if (getNodesReadOnly())
      return

    const { x, y } = dragNodeStartPosition.current
    if (!(x === node.position.x && y === node.position.y)) {
      setHelpLineHorizontal()
      setHelpLineVertical()
      handleSyncWorkflowDraft()
    }
  }, [handleSyncWorkflowDraft, workflowStore, getNodesReadOnly])

  const handleNodeEnter = useCallback<NodeMouseHandler>((_, node) => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()

    if (connectingNodeRef.current && connectingNodeRef.current.nodeId !== node.id) {
      const connectingNode: Node = nodes.find(n => n.id === connectingNodeRef.current!.nodeId)!
      const handleType = connectingNodeRef.current.handleType
      const currentNodeIndex = nodes.findIndex(n => n.id === node.id)
      const availablePrevNodes = nodesExtraData[connectingNode.data.type].availablePrevNodes
      const availableNextNodes = nodesExtraData[connectingNode.data.type].availableNextNodes
      const availableNodes = handleType === 'source' ? availableNextNodes : [...availablePrevNodes, BlockEnum.Start]

      const newNodes = produce(nodes, (draft) => {
        if (!availableNodes.includes(draft[currentNodeIndex].data.type))
          draft[currentNodeIndex].data._isInvalidConnection = true
      })
      setNodes(newNodes)
    }
    const newEdges = produce(edges, (draft) => {
      const connectedEdges = getConnectedEdges([node], edges)

      connectedEdges.forEach((edge) => {
        const currentEdge = draft.find(e => e.id === edge.id)
        if (currentEdge)
          currentEdge.data._connectedNodeIsHovering = true
      })
    })
    setEdges(newEdges)
  }, [store, nodesExtraData, getNodesReadOnly])

  const handleNodeLeave = useCallback<NodeMouseHandler>(() => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        node.data._isInvalidConnection = false
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.data._connectedNodeIsHovering = false
      })
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  const handleNodeSelect = useCallback((nodeId: string, cancelSelection?: boolean) => {
    if (getNodesReadOnly() && !workflowStore.getState().isRestoring)
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
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

    const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges).map(edge => edge.id)
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        if (connectedEdges.includes(edge.id)) {
          edge.data = {
            ...edge.data,
            _connectedNodeIsSelected: !cancelSelection,
          }
        }
        else {
          edge.data = {
            ...edge.data,
            _connectedNodeIsSelected: false,
          }
        }
      })
    })
    setEdges(newEdges)

    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft, getNodesReadOnly, workflowStore])

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    if (getNodesReadOnly() && !workflowStore.getState().isRestoring)
      return

    handleNodeSelect(node.id)
  }, [handleNodeSelect, getNodesReadOnly, workflowStore])

  const handleNodeConnect = useCallback<OnConnect>(({
    source,
    sourceHandle,
    target,
    targetHandle,
  }) => {
    if (source === target)
      return
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const targetNode = nodes.find(node => node.id === target!)
    if (targetNode && targetNode?.data.type === BlockEnum.VariableAssigner) {
      const treeNodes = getTreeLeafNodes(target!)

      if (!treeNodes.find(treeNode => treeNode.id === source))
        return
    }
    const needDeleteEdges = edges.filter((edge) => {
      if (
        (edge.source === source && edge.sourceHandle === sourceHandle)
        || (edge.target === target && edge.targetHandle === targetHandle)
      )
        return true

      return false
    })
    const needDeleteEdgesIds = needDeleteEdges.map(edge => edge.id)
    const newEdge = {
      id: `${source}-${target}`,
      type: 'custom',
      source: source!,
      target: target!,
      sourceHandle,
      targetHandle,
      data: {
        sourceType: nodes.find(node => node.id === source)!.data.type,
        targetType: nodes.find(node => node.id === target)!.data.type,
      },
    }
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
  }, [store, handleSyncWorkflowDraft, getNodesReadOnly, getTreeLeafNodes])

  const handleNodeConnectStart = useCallback<OnConnectStart>((_, { nodeId, handleType }) => {
    if (nodeId && handleType) {
      connectingNodeRef.current = {
        nodeId,
        handleType,
      }
    }
  }, [])

  const handleNodeConnectEnd = useCallback(() => {
    connectingNodeRef.current = null
  }, [])

  const handleNodeDelete = useCallback((nodeId: string) => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()

    const nodes = getNodes()
    const currentNodeIndex = nodes.findIndex(node => node.id === nodeId)
    if (nodes[currentNodeIndex].data.type === BlockEnum.Start)
      return
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
  }, [store, handleSyncWorkflowDraft, getNodesReadOnly])

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
    if (getNodesReadOnly())
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
        ...NODES_INITIAL_DATA[nodeType],
        title: nodesWithSameType.length > 0 ? `${t(`workflow.blocks.${nodeType}`)} ${nodesWithSameType.length + 1}` : t(`workflow.blocks.${nodeType}`),
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
      if (prevNode.data.type === BlockEnum.KnowledgeRetrieval)
        targetHandle = prevNodeId
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
        data: {
          sourceType: prevNode.data.type,
          targetType: newNode.data.type,
          _connectedNodeIsSelected: true,
        },
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
        draft.forEach((item) => {
          item.data = {
            ...item.data,
            _connectedNodeIsSelected: false,
          }
        })
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
        data: {
          sourceType: newNode.data.type,
          targetType: nextNode.data.type,
          _connectedNodeIsSelected: true,
        },
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
        draft.forEach((item) => {
          item.data = {
            ...item.data,
            _connectedNodeIsSelected: false,
          }
        })
        draft.push(newEdge)
      })
      setEdges(newEdges)
    }
    if (prevNodeId && nextNodeId) {
      const prevNode = nodes.find(node => node.id === prevNodeId)!
      const nextNode = nodes.find(node => node.id === nextNodeId)!
      if (prevNode.data.type === BlockEnum.KnowledgeRetrieval)
        targetHandle = prevNodeId
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
        data: {
          sourceType: prevNode.data.type,
          targetType: newNode.data.type,
          _connectedNodeIsSelected: true,
        },
      }
      let newNextEdge: Edge | null = null
      if (nodeType !== BlockEnum.IfElse && nodeType !== BlockEnum.QuestionClassifier) {
        newNextEdge = {
          id: `${newNode.id}-${nextNodeId}`,
          type: 'custom',
          source: newNode.id,
          sourceHandle,
          target: nextNodeId,
          targetHandle: nextNodeTargetHandle,
          data: {
            sourceType: newNode.data.type,
            targetType: nextNode.data.type,
            _connectedNodeIsSelected: true,
          },
        }
      }
      const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        [
          { type: 'remove', edge: edges[currentEdgeIndex] },
          { type: 'add', edge: newPrevEdge },
          ...(newNextEdge ? [{ type: 'add', edge: newNextEdge }] : []),
        ],
        [...nodes, newNode],
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
        draft.forEach((item) => {
          item.data = {
            ...item.data,
            _connectedNodeIsSelected: false,
          }
        })
        draft.push(newPrevEdge)

        if (newNextEdge)
          draft.push(newNextEdge)
      })
      setEdges(newEdges)
    }
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft, getAfterNodesInSameBranch, getNodesReadOnly, t])

  const handleNodeChange = useCallback((
    currentNodeId: string,
    nodeType: BlockEnum,
    sourceHandle: string,
    toolDefaultValue?: ToolDefaultValue,
  ) => {
    if (getNodesReadOnly())
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
        ...NODES_INITIAL_DATA[nodeType],
        title: nodesWithSameType.length > 0 ? `${t(`workflow.blocks.${nodeType}`)} ${nodesWithSameType.length + 1}` : t(`workflow.blocks.${nodeType}`),
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
  }, [store, handleSyncWorkflowDraft, getNodesReadOnly, t])

  const handleNodeCopySelected = useCallback((): undefined | Node[] => {
    if (getNodesReadOnly())
      return

    const {
      setClipboardElements,
      shortcutsDisabled,
    } = workflowStore.getState()

    if (shortcutsDisabled)
      return

    const {
      getNodes,
    } = store.getState()

    const nodes = getNodes()
    const nodesToCopy = nodes.filter(node => node.data.selected && node.data.type !== BlockEnum.Start)

    setClipboardElements(nodesToCopy)

    return nodesToCopy
  }, [getNodesReadOnly, store, workflowStore])

  const handleNodePaste = useCallback((): undefined | Node[] => {
    if (getNodesReadOnly())
      return

    const {
      clipboardElements,
      shortcutsDisabled,
    } = workflowStore.getState()

    if (shortcutsDisabled)
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodesToPaste: Node[] = []
    const nodes = getNodes()

    for (const nodeToPaste of clipboardElements) {
      const nodeType = nodeToPaste.data.type
      const nodesWithSameType = nodes.filter(node => node.data.type === nodeType)

      const newNode = generateNewNode({
        data: {
          ...NODES_INITIAL_DATA[nodeType],
          ...nodeToPaste.data,
          _connectedSourceHandleIds: [],
          _connectedTargetHandleIds: [],
          title: nodesWithSameType.length > 0 ? `${t(`workflow.blocks.${nodeType}`)} ${nodesWithSameType.length + 1}` : t(`workflow.blocks.${nodeType}`),
          selected: true,
        },
        position: {
          x: nodeToPaste.position.x + 10,
          y: nodeToPaste.position.y + 10,
        },
      })
      nodesToPaste.push(newNode)
    }

    setNodes([...nodes.map((n: Node) => ({ ...n, selected: false, data: { ...n.data, selected: false } })), ...nodesToPaste])

    handleSyncWorkflowDraft()

    return nodesToPaste
  }, [getNodesReadOnly, handleSyncWorkflowDraft, store, t, workflowStore])

  const handleNodeDuplicateSelected = useCallback(() => {
    if (getNodesReadOnly())
      return

    handleNodeCopySelected()
    handleNodePaste()
  }, [getNodesReadOnly, handleNodeCopySelected, handleNodePaste])

  const handleNodeCut = useCallback(() => {
    if (getNodesReadOnly())
      return

    const nodesToCut = handleNodeCopySelected()
    if (!nodesToCut)
      return

    for (const node of nodesToCut)
      handleNodeDelete(node.id)
  }, [getNodesReadOnly, handleNodeCopySelected, handleNodeDelete])

  const handleNodeDeleteSelected = useCallback(() => {
    if (getNodesReadOnly())
      return

    const {
      shortcutsDisabled,
    } = workflowStore.getState()

    if (shortcutsDisabled)
      return

    const {
      getNodes,
      edges,
    } = store.getState()

    const currentEdgeIndex = edges.findIndex(edge => edge.selected)

    if (currentEdgeIndex > -1)
      return

    const nodes = getNodes()
    const nodesToDelete = nodes.filter(node => node.data.selected)

    if (!nodesToDelete)
      return

    for (const node of nodesToDelete)
      handleNodeDelete(node.id)
  }, [getNodesReadOnly, handleNodeDelete, store, workflowStore])

  return {
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleNodeEnter,
    handleNodeLeave,
    handleNodeSelect,
    handleNodeClick,
    handleNodeConnect,
    handleNodeConnectStart,
    handleNodeConnectEnd,
    handleNodeDelete,
    handleNodeChange,
    handleNodeAdd,
    handleNodeDuplicateSelected,
    handleNodeCopySelected,
    handleNodeCut,
    handleNodeDeleteSelected,
    handleNodePaste,
  }
}
