import type { MouseEvent } from 'react'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type {
  NodeDragHandler,
  NodeMouseHandler,
  OnConnect,
  OnConnectEnd,
  OnConnectStart,
  ResizeParamsWithDirection,
} from 'reactflow'
import {
  getConnectedEdges,
  getOutgoers,
  useReactFlow,
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
  ITERATION_CHILDREN_Z_INDEX,
  ITERATION_PADDING,
  NODES_INITIAL_DATA,
  NODE_WIDTH_X_OFFSET,
  X_OFFSET,
  Y_OFFSET,
} from '../constants'
import {
  genNewNodeTitleFromOld,
  generateNewNode,
  getNodesConnectedSourceOrTargetHandleIdsMap,
  getTopLeftNodePosition,
} from '../utils'
import type { IterationNodeType } from '../nodes/iteration/types'
import type { VariableAssignerNodeType } from '../nodes/variable-assigner/types'
import { useNodeIterationInteractions } from '../nodes/iteration/use-interactions'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useHelpline } from './use-helpline'
import {
  useNodesReadOnly,
  useWorkflow,
} from './use-workflow'

export const useNodesInteractions = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    getAfterNodesInSameBranch,
  } = useWorkflow()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleSetHelpline } = useHelpline()
  const {
    handleNodeIterationChildDrag,
    handleNodeIterationChildrenCopy,
  } = useNodeIterationInteractions()
  const dragNodeStartPosition = useRef({ x: 0, y: 0 } as { x: number; y: number })

  const handleNodeDragStart = useCallback<NodeDragHandler>((_, node) => {
    workflowStore.setState({ nodeAnimation: false })

    if (getNodesReadOnly())
      return

    if (node.data.isIterationStart)
      return

    dragNodeStartPosition.current = { x: node.position.x, y: node.position.y }
  }, [workflowStore, getNodesReadOnly])

  const handleNodeDrag = useCallback<NodeDragHandler>((e, node: Node) => {
    if (getNodesReadOnly())
      return

    if (node.data.isIterationStart)
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()
    e.stopPropagation()

    const nodes = getNodes()

    const { restrictPosition } = handleNodeIterationChildDrag(node)

    const {
      showHorizontalHelpLineNodes,
      showVerticalHelpLineNodes,
    } = handleSetHelpline(node)
    const showHorizontalHelpLineNodesLength = showHorizontalHelpLineNodes.length
    const showVerticalHelpLineNodesLength = showVerticalHelpLineNodes.length

    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(n => n.id === node.id)!

      if (showVerticalHelpLineNodesLength > 0)
        currentNode.position.x = showVerticalHelpLineNodes[0].position.x
      else if (restrictPosition.x !== undefined)
        currentNode.position.x = restrictPosition.x
      else
        currentNode.position.x = node.position.x

      if (showHorizontalHelpLineNodesLength > 0)
        currentNode.position.y = showHorizontalHelpLineNodes[0].position.y
      else if (restrictPosition.y !== undefined)
        currentNode.position.y = restrictPosition.y
      else
        currentNode.position.y = node.position.y
    })

    setNodes(newNodes)
  }, [store, getNodesReadOnly, handleSetHelpline, handleNodeIterationChildDrag])

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
    const {
      connectingNodePayload,
      setEnteringNodePayload,
    } = workflowStore.getState()

    if (connectingNodePayload) {
      if (connectingNodePayload.nodeId === node.id)
        return
      const connectingNode: Node = nodes.find(n => n.id === connectingNodePayload.nodeId)!
      const sameLevel = connectingNode.parentId === node.parentId

      if (sameLevel) {
        setEnteringNodePayload({
          nodeId: node.id,
        })
        const fromType = connectingNodePayload.handleType

        const newNodes = produce(nodes, (draft) => {
          draft.forEach((n) => {
            if (n.id === node.id && fromType === 'source' && (node.data.type === BlockEnum.VariableAssigner || node.data.type === BlockEnum.VariableAggregator)) {
              if (!node.data.advanced_settings?.group_enabled)
                n.data._isEntering = true
            }
            if (n.id === node.id && fromType === 'target' && (connectingNode.data.type === BlockEnum.VariableAssigner || connectingNode.data.type === BlockEnum.VariableAggregator) && node.data.type !== BlockEnum.IfElse && node.data.type !== BlockEnum.QuestionClassifier)
              n.data._isEntering = true
          })
        })
        setNodes(newNodes)
      }
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
  }, [store, workflowStore, getNodesReadOnly])

  const handleNodeLeave = useCallback<NodeMouseHandler>(() => {
    if (getNodesReadOnly())
      return

    const {
      setEnteringNodePayload,
    } = workflowStore.getState()
    setEnteringNodePayload(undefined)
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        node.data._isEntering = false
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.data._connectedNodeIsHovering = false
      })
    })
    setEdges(newEdges)
  }, [store, workflowStore, getNodesReadOnly])

  const handleNodeSelect = useCallback((nodeId: string, cancelSelection?: boolean) => {
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
  }, [store, handleSyncWorkflowDraft])

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    handleNodeSelect(node.id)
  }, [handleNodeSelect])

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
    const sourceNode = nodes.find(node => node.id === source!)

    if (targetNode?.parentId !== sourceNode?.parentId)
      return

    if (targetNode?.data.isIterationStart)
      return

    const needDeleteEdges = edges.filter((edge) => {
      if (
        (edge.source === source && edge.sourceHandle === sourceHandle)
        || (edge.target === target && edge.targetHandle === targetHandle && targetNode?.data.type !== BlockEnum.VariableAssigner && targetNode?.data.type !== BlockEnum.VariableAggregator)
      )
        return true

      return false
    })
    const needDeleteEdgesIds = needDeleteEdges.map(edge => edge.id)
    const newEdge = {
      id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
      type: 'custom',
      source: source!,
      target: target!,
      sourceHandle,
      targetHandle,
      data: {
        sourceType: nodes.find(node => node.id === source)!.data.type,
        targetType: nodes.find(node => node.id === target)!.data.type,
        isInIteration: !!targetNode?.parentId,
        iteration_id: targetNode?.parentId,
      },
      zIndex: targetNode?.parentId ? ITERATION_CHILDREN_Z_INDEX : 0,
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
  }, [store, handleSyncWorkflowDraft, getNodesReadOnly])

  const handleNodeConnectStart = useCallback<OnConnectStart>((_, { nodeId, handleType, handleId }) => {
    if (getNodesReadOnly())
      return

    if (nodeId && handleType) {
      const { setConnectingNodePayload } = workflowStore.getState()
      const { getNodes } = store.getState()
      const node = getNodes().find(n => n.id === nodeId)!

      if (!node.data.isIterationStart) {
        setConnectingNodePayload({
          nodeId,
          nodeType: node.data.type,
          handleType,
          handleId,
        })
      }
    }
  }, [store, workflowStore, getNodesReadOnly])

  const handleNodeConnectEnd = useCallback<OnConnectEnd>((e: any) => {
    if (getNodesReadOnly())
      return

    const {
      connectingNodePayload,
      setConnectingNodePayload,
      enteringNodePayload,
      setEnteringNodePayload,
    } = workflowStore.getState()
    if (connectingNodePayload && enteringNodePayload) {
      const {
        setShowAssignVariablePopup,
        hoveringAssignVariableGroupId,
      } = workflowStore.getState()
      const { screenToFlowPosition } = reactflow
      const {
        getNodes,
        setNodes,
      } = store.getState()
      const nodes = getNodes()
      const fromHandleType = connectingNodePayload.handleType
      const fromHandleId = connectingNodePayload.handleId
      const fromNode = nodes.find(n => n.id === connectingNodePayload.nodeId)!
      const fromNodeParent = nodes.find(n => n.id === fromNode.parentId)
      const toNode = nodes.find(n => n.id === enteringNodePayload.nodeId)!
      const toParentNode = nodes.find(n => n.id === toNode.parentId)

      if (fromNode.parentId !== toNode.parentId)
        return

      const { x, y } = screenToFlowPosition({ x: e.x, y: e.y })

      if (fromHandleType === 'source' && (toNode.data.type === BlockEnum.VariableAssigner || toNode.data.type === BlockEnum.VariableAggregator)) {
        const groupEnabled = toNode.data.advanced_settings?.group_enabled

        if (
          (groupEnabled && hoveringAssignVariableGroupId)
          || !groupEnabled
        ) {
          const newNodes = produce(nodes, (draft) => {
            draft.forEach((node) => {
              if (node.id === toNode.id) {
                node.data._showAddVariablePopup = true
                node.data._holdAddVariablePopup = true
              }
            })
          })
          setNodes(newNodes)
          setShowAssignVariablePopup({
            nodeId: fromNode.id,
            nodeData: fromNode.data,
            variableAssignerNodeId: toNode.id,
            variableAssignerNodeData: toNode.data,
            variableAssignerNodeHandleId: hoveringAssignVariableGroupId || 'target',
            parentNode: toParentNode,
            x: x - toNode.positionAbsolute!.x,
            y: y - toNode.positionAbsolute!.y,
          })
          handleNodeConnect({
            source: fromNode.id,
            sourceHandle: fromHandleId,
            target: toNode.id,
            targetHandle: hoveringAssignVariableGroupId || 'target',
          })
        }
      }
      if (fromHandleType === 'target' && (fromNode.data.type === BlockEnum.VariableAssigner || fromNode.data.type === BlockEnum.VariableAggregator) && toNode.data.type !== BlockEnum.IfElse && toNode.data.type !== BlockEnum.QuestionClassifier) {
        const newNodes = produce(nodes, (draft) => {
          draft.forEach((node) => {
            if (node.id === toNode.id) {
              node.data._showAddVariablePopup = true
              node.data._holdAddVariablePopup = true
            }
          })
        })
        setNodes(newNodes)
        setShowAssignVariablePopup({
          nodeId: toNode.id,
          nodeData: toNode.data,
          variableAssignerNodeId: fromNode.id,
          variableAssignerNodeData: fromNode.data,
          variableAssignerNodeHandleId: fromHandleId || 'target',
          parentNode: fromNodeParent,
          x: x - toNode.positionAbsolute!.x,
          y: y - toNode.positionAbsolute!.y,
        })
        handleNodeConnect({
          source: toNode.id,
          sourceHandle: 'source',
          target: fromNode.id,
          targetHandle: fromHandleId,
        })
      }
    }
    setConnectingNodePayload(undefined)
    setEnteringNodePayload(undefined)
  }, [store, handleNodeConnect, getNodesReadOnly, workflowStore, reactflow])

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
    const currentNode = nodes[currentNodeIndex]

    if (!currentNode)
      return

    if (currentNode.data.type === BlockEnum.Start)
      return

    if (currentNode.data.type === BlockEnum.Iteration) {
      const iterationChildren = nodes.filter(node => node.parentId === currentNode.id)

      if (iterationChildren.length) {
        if (currentNode.data._isBundled) {
          iterationChildren.forEach((child) => {
            handleNodeDelete(child.id)
          })
          return handleNodeDelete(nodeId)
        }
        else {
          const { setShowConfirm, showConfirm } = workflowStore.getState()

          if (!showConfirm) {
            setShowConfirm({
              title: t('workflow.nodes.iteration.deleteTitle'),
              desc: t('workflow.nodes.iteration.deleteDesc') || '',
              onConfirm: () => {
                iterationChildren.forEach((child) => {
                  handleNodeDelete(child.id)
                })
                handleNodeDelete(nodeId)
                handleSyncWorkflowDraft()
                setShowConfirm(undefined)
              },
            })
            return
          }
        }
      }
    }
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

        if (node.id === currentNode.parentId) {
          node.data._children = node.data._children?.filter(child => child !== nodeId)

          if (currentNode.id === (node as Node<IterationNodeType>).data.start_node_id) {
            (node as Node<IterationNodeType>).data.start_node_id = '';
            (node as Node<IterationNodeType>).data.startNodeType = undefined
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
  }, [store, handleSyncWorkflowDraft, getNodesReadOnly, workflowStore, t])

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
        _showAddVariablePopup: (nodeType === BlockEnum.VariableAssigner || nodeType === BlockEnum.VariableAggregator) && !!prevNodeId,
        _holdAddVariablePopup: false,
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
        x: lastOutgoer ? lastOutgoer.position.x : prevNode.position.x + prevNode.width! + X_OFFSET,
        y: lastOutgoer ? lastOutgoer.position.y + lastOutgoer.height! + Y_OFFSET : prevNode.position.y,
      }
      newNode.parentId = prevNode.parentId
      newNode.extent = prevNode.extent
      if (prevNode.parentId) {
        newNode.data.isInIteration = true
        newNode.data.iteration_id = prevNode.parentId
        newNode.zIndex = ITERATION_CHILDREN_Z_INDEX
      }

      const newEdge: Edge = {
        id: `${prevNodeId}-${prevNodeSourceHandle}-${newNode.id}-${targetHandle}`,
        type: 'custom',
        source: prevNodeId,
        sourceHandle: prevNodeSourceHandle,
        target: newNode.id,
        targetHandle,
        data: {
          sourceType: prevNode.data.type,
          targetType: newNode.data.type,
          isInIteration: !!prevNode.parentId,
          iteration_id: prevNode.parentId,
          _connectedNodeIsSelected: true,
        },
        zIndex: prevNode.parentId ? ITERATION_CHILDREN_Z_INDEX : 0,
      }
      const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        [
          { type: 'add', edge: newEdge },
        ],
        nodes,
      )
      const newNodes = produce(nodes, (draft: Node[]) => {
        draft.forEach((node) => {
          node.data.selected = false

          if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
            node.data = {
              ...node.data,
              ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
            }
          }

          if (node.data.type === BlockEnum.Iteration && prevNode.parentId === node.id)
            node.data._children?.push(newNode.id)
        })
        draft.push(newNode)
      })
      setNodes(newNodes)
      if (newNode.data.type === BlockEnum.VariableAssigner || newNode.data.type === BlockEnum.VariableAggregator) {
        const { setShowAssignVariablePopup } = workflowStore.getState()

        setShowAssignVariablePopup({
          nodeId: prevNode.id,
          nodeData: prevNode.data,
          variableAssignerNodeId: newNode.id,
          variableAssignerNodeData: (newNode.data as VariableAssignerNodeType),
          variableAssignerNodeHandleId: targetHandle,
          parentNode: nodes.find(node => node.id === newNode.parentId),
          x: -25,
          y: 44,
        })
      }
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
      if ((nodeType !== BlockEnum.IfElse) && (nodeType !== BlockEnum.QuestionClassifier))
        newNode.data._connectedSourceHandleIds = [sourceHandle]
      newNode.data._connectedTargetHandleIds = []
      newNode.position = {
        x: nextNode.position.x,
        y: nextNode.position.y,
      }
      newNode.parentId = nextNode.parentId
      newNode.extent = nextNode.extent
      if (nextNode.parentId) {
        newNode.data.isInIteration = true
        newNode.data.iteration_id = nextNode.parentId
        newNode.zIndex = ITERATION_CHILDREN_Z_INDEX
      }
      if (nextNode.data.isIterationStart)
        newNode.data.isIterationStart = true

      let newEdge

      if ((nodeType !== BlockEnum.IfElse) && (nodeType !== BlockEnum.QuestionClassifier)) {
        newEdge = {
          id: `${newNode.id}-${sourceHandle}-${nextNodeId}-${nextNodeTargetHandle}`,
          type: 'custom',
          source: newNode.id,
          sourceHandle,
          target: nextNodeId,
          targetHandle: nextNodeTargetHandle,
          data: {
            sourceType: newNode.data.type,
            targetType: nextNode.data.type,
            isInIteration: !!nextNode.parentId,
            iteration_id: nextNode.parentId,
            _connectedNodeIsSelected: true,
          },
          zIndex: nextNode.parentId ? ITERATION_CHILDREN_Z_INDEX : 0,
        }
      }

      let nodesConnectedSourceOrTargetHandleIdsMap: Record<string, any>
      if (newEdge) {
        nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
          [
            { type: 'add', edge: newEdge },
          ],
          nodes,
        )
      }

      const afterNodesInSameBranch = getAfterNodesInSameBranch(nextNodeId!)
      const afterNodesInSameBranchIds = afterNodesInSameBranch.map(node => node.id)
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          node.data.selected = false

          if (afterNodesInSameBranchIds.includes(node.id))
            node.position.x += NODE_WIDTH_X_OFFSET

          if (nodesConnectedSourceOrTargetHandleIdsMap?.[node.id]) {
            node.data = {
              ...node.data,
              ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
            }
          }

          if (node.data.type === BlockEnum.Iteration && nextNode.parentId === node.id)
            node.data._children?.push(newNode.id)

          if (node.data.type === BlockEnum.Iteration && node.data.start_node_id === nextNodeId) {
            node.data.start_node_id = newNode.id
            node.data.startNodeType = newNode.data.type
          }

          if (node.id === nextNodeId && node.data.isIterationStart)
            node.data.isIterationStart = false
        })
        draft.push(newNode)
      })
      setNodes(newNodes)
      if (newEdge) {
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
    }
    if (prevNodeId && nextNodeId) {
      const prevNode = nodes.find(node => node.id === prevNodeId)!
      const nextNode = nodes.find(node => node.id === nextNodeId)!

      newNode.data._connectedTargetHandleIds = [targetHandle]
      newNode.data._connectedSourceHandleIds = [sourceHandle]
      newNode.position = {
        x: nextNode.position.x,
        y: nextNode.position.y,
      }
      newNode.parentId = prevNode.parentId
      newNode.extent = prevNode.extent
      if (prevNode.parentId) {
        newNode.data.isInIteration = true
        newNode.data.iteration_id = prevNode.parentId
        newNode.zIndex = ITERATION_CHILDREN_Z_INDEX
      }

      const currentEdgeIndex = edges.findIndex(edge => edge.source === prevNodeId && edge.target === nextNodeId)
      const newPrevEdge = {
        id: `${prevNodeId}-${prevNodeSourceHandle}-${newNode.id}-${targetHandle}`,
        type: 'custom',
        source: prevNodeId,
        sourceHandle: prevNodeSourceHandle,
        target: newNode.id,
        targetHandle,
        data: {
          sourceType: prevNode.data.type,
          targetType: newNode.data.type,
          isInIteration: !!prevNode.parentId,
          iteration_id: prevNode.parentId,
          _connectedNodeIsSelected: true,
        },
        zIndex: prevNode.parentId ? ITERATION_CHILDREN_Z_INDEX : 0,
      }
      let newNextEdge: Edge | null = null
      if (nodeType !== BlockEnum.IfElse && nodeType !== BlockEnum.QuestionClassifier) {
        newNextEdge = {
          id: `${newNode.id}-${sourceHandle}-${nextNodeId}-${nextNodeTargetHandle}`,
          type: 'custom',
          source: newNode.id,
          sourceHandle,
          target: nextNodeId,
          targetHandle: nextNodeTargetHandle,
          data: {
            sourceType: newNode.data.type,
            targetType: nextNode.data.type,
            isInIteration: !!nextNode.parentId,
            iteration_id: nextNode.parentId,
            _connectedNodeIsSelected: true,
          },
          zIndex: nextNode.parentId ? ITERATION_CHILDREN_Z_INDEX : 0,
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

          if (node.data.type === BlockEnum.Iteration && prevNode.parentId === node.id)
            node.data._children?.push(newNode.id)
        })
        draft.push(newNode)
      })
      setNodes(newNodes)
      if (newNode.data.type === BlockEnum.VariableAssigner || newNode.data.type === BlockEnum.VariableAggregator) {
        const { setShowAssignVariablePopup } = workflowStore.getState()

        setShowAssignVariablePopup({
          nodeId: prevNode.id,
          nodeData: prevNode.data,
          variableAssignerNodeId: newNode.id,
          variableAssignerNodeData: newNode.data as VariableAssignerNodeType,
          variableAssignerNodeHandleId: targetHandle,
          parentNode: nodes.find(node => node.id === newNode.parentId),
          x: -25,
          y: 44,
        })
      }
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
  }, [store, workflowStore, handleSyncWorkflowDraft, getAfterNodesInSameBranch, getNodesReadOnly, t])

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
        isInIteration: currentNode.data.isInIteration,
        iteration_id: currentNode.data.iteration_id,
        isIterationStart: currentNode.data.isIterationStart,
      },
      position: {
        x: currentNode.position.x,
        y: currentNode.position.y,
      },
      parentId: currentNode.parentId,
      extent: currentNode.extent,
      zIndex: currentNode.zIndex,
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
        if (node.id === currentNode.parentId && currentNode.data.isIterationStart) {
          node.data._children = [
            newCurrentNode.id,
            ...(node.data._children || []),
          ].filter(child => child !== currentNodeId)
          node.data.start_node_id = newCurrentNode.id
          node.data.startNodeType = newCurrentNode.data.type
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

  const handleNodeCancelRunningStatus = useCallback(() => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data._runningStatus = undefined
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleNodesCancelSelected = useCallback(() => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data.selected = false
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleNodeContextMenu = useCallback((e: MouseEvent, node: Node) => {
    e.preventDefault()
    const container = document.querySelector('#workflow-container')
    const { x, y } = container!.getBoundingClientRect()
    workflowStore.setState({
      nodeMenu: {
        top: e.clientY - y,
        left: e.clientX - x,
        nodeId: node.id,
      },
    })
    handleNodeSelect(node.id)
  }, [workflowStore, handleNodeSelect])

  const handleNodesCopy = useCallback(() => {
    if (getNodesReadOnly())
      return

    const {
      setClipboardElements,
      shortcutsDisabled,
      showFeaturesPanel,
    } = workflowStore.getState()

    if (shortcutsDisabled || showFeaturesPanel)
      return

    const {
      getNodes,
    } = store.getState()

    const nodes = getNodes()
    const bundledNodes = nodes.filter(node => node.data._isBundled && node.data.type !== BlockEnum.Start && !node.data.isInIteration)

    if (bundledNodes.length) {
      setClipboardElements(bundledNodes)
      return
    }

    const selectedNode = nodes.find(node => node.data.selected && node.data.type !== BlockEnum.Start)

    if (selectedNode)
      setClipboardElements([selectedNode])
  }, [getNodesReadOnly, store, workflowStore])

  const handleNodesPaste = useCallback(() => {
    if (getNodesReadOnly())
      return

    const {
      clipboardElements,
      shortcutsDisabled,
      showFeaturesPanel,
      mousePosition,
    } = workflowStore.getState()

    if (shortcutsDisabled || showFeaturesPanel)
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodesToPaste: Node[] = []
    const nodes = getNodes()

    if (clipboardElements.length) {
      const { x, y } = getTopLeftNodePosition(clipboardElements)
      const { screenToFlowPosition } = reactflow
      const currentPosition = screenToFlowPosition({ x: mousePosition.pageX, y: mousePosition.pageY })
      const offsetX = currentPosition.x - x
      const offsetY = currentPosition.y - y
      clipboardElements.forEach((nodeToPaste, index) => {
        const nodeType = nodeToPaste.data.type

        const newNode = generateNewNode({
          data: {
            ...NODES_INITIAL_DATA[nodeType],
            ...nodeToPaste.data,
            selected: false,
            _isBundled: false,
            _connectedSourceHandleIds: [],
            _connectedTargetHandleIds: [],
            title: genNewNodeTitleFromOld(nodeToPaste.data.title),
          },
          position: {
            x: nodeToPaste.position.x + offsetX,
            y: nodeToPaste.position.y + offsetY,
          },
          extent: nodeToPaste.extent,
          zIndex: nodeToPaste.zIndex,
        })
        newNode.id = newNode.id + index

        let newChildren: Node[] = []
        if (nodeToPaste.data.type === BlockEnum.Iteration) {
          newNode.data._children = [];
          (newNode.data as IterationNodeType).start_node_id = ''

          newChildren = handleNodeIterationChildrenCopy(nodeToPaste.id, newNode.id)

          newChildren.forEach((child) => {
            newNode.data._children?.push(child.id)
            if (child.data.isIterationStart)
              (newNode.data as IterationNodeType).start_node_id = child.id
          })
        }

        nodesToPaste.push(newNode)

        if (newChildren.length)
          nodesToPaste.push(...newChildren)
      })

      setNodes([...nodes, ...nodesToPaste])
      handleSyncWorkflowDraft()
    }
  }, [t, getNodesReadOnly, store, workflowStore, handleSyncWorkflowDraft, reactflow, handleNodeIterationChildrenCopy])

  const handleNodesDuplicate = useCallback(() => {
    if (getNodesReadOnly())
      return

    handleNodesCopy()
    handleNodesPaste()
  }, [getNodesReadOnly, handleNodesCopy, handleNodesPaste])

  const handleNodesDelete = useCallback(() => {
    if (getNodesReadOnly())
      return

    const {
      shortcutsDisabled,
      showFeaturesPanel,
    } = workflowStore.getState()

    if (shortcutsDisabled || showFeaturesPanel)
      return

    const {
      getNodes,
      edges,
    } = store.getState()

    const nodes = getNodes()
    const bundledNodes = nodes.filter(node => node.data._isBundled && node.data.type !== BlockEnum.Start)

    if (bundledNodes.length) {
      bundledNodes.forEach(node => handleNodeDelete(node.id))

      return
    }

    const edgeSelected = edges.some(edge => edge.selected)
    if (edgeSelected)
      return

    const selectedNode = nodes.find(node => node.data.selected && node.data.type !== BlockEnum.Start)

    if (selectedNode)
      handleNodeDelete(selectedNode.id)
  }, [store, workflowStore, getNodesReadOnly, handleNodeDelete])

  const handleNodeResize = useCallback((nodeId: string, params: ResizeParamsWithDirection) => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()
    const { x, y, width, height } = params

    const nodes = getNodes()
    const currentNode = nodes.find(n => n.id === nodeId)!
    const childrenNodes = nodes.filter(n => currentNode.data._children?.includes(n.id))
    let rightNode: Node
    let bottomNode: Node

    childrenNodes.forEach((n) => {
      if (rightNode) {
        if (n.position.x + n.width! > rightNode.position.x + rightNode.width!)
          rightNode = n
      }
      else {
        rightNode = n
      }
      if (bottomNode) {
        if (n.position.y + n.height! > bottomNode.position.y + bottomNode.height!)
          bottomNode = n
      }
      else {
        bottomNode = n
      }
    })

    if (rightNode! && bottomNode!) {
      if (width < rightNode!.position.x + rightNode.width! + ITERATION_PADDING.right)
        return
      if (height < bottomNode.position.y + bottomNode.height! + ITERATION_PADDING.bottom)
        return
    }
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((n) => {
        if (n.id === nodeId) {
          n.data.width = width
          n.data.height = height
          n.width = width
          n.height = height
          n.position.x = x
          n.position.y = y
        }
      })
    })
    setNodes(newNodes)
    handleSyncWorkflowDraft()
  }, [store, getNodesReadOnly, handleSyncWorkflowDraft])

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
    handleNodeCancelRunningStatus,
    handleNodesCancelSelected,
    handleNodeContextMenu,
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
    handleNodeResize,
  }
}
