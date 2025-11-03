import type { MouseEvent } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
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
import type { DataSourceDefaultValue, ToolDefaultValue } from '../block-selector/types'
import type { Edge, Node, OnNodeAdd } from '../types'
import { BlockEnum } from '../types'
import { useWorkflowStore } from '../store'
import {
  CUSTOM_EDGE,
  ITERATION_CHILDREN_Z_INDEX,
  ITERATION_PADDING,
  LOOP_CHILDREN_Z_INDEX,
  LOOP_PADDING,
  NODE_WIDTH_X_OFFSET,
  X_OFFSET,
  Y_OFFSET,
} from '../constants'
import {
  genNewNodeTitleFromOld,
  generateNewNode,
  getNestedNodePosition,
  getNodeCustomTypeByNodeDataType,
  getNodesConnectedSourceOrTargetHandleIdsMap,
  getTopLeftNodePosition,
} from '../utils'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'
import type { IterationNodeType } from '../nodes/iteration/types'
import type { LoopNodeType } from '../nodes/loop/types'
import { CUSTOM_ITERATION_START_NODE } from '../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../nodes/loop-start/constants'
import type { VariableAssignerNodeType } from '../nodes/variable-assigner/types'
import { useNodeIterationInteractions } from '../nodes/iteration/use-interactions'
import { useNodeLoopInteractions } from '../nodes/loop/use-interactions'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useHelpline } from './use-helpline'
import {
  useNodesReadOnly,
  useWorkflow,
  useWorkflowReadOnly,
} from './use-workflow'
import {
  WorkflowHistoryEvent,
  useWorkflowHistory,
} from './use-workflow-history'
import { useNodesMetaData } from './use-nodes-meta-data'
import type { RAGPipelineVariables } from '@/models/pipeline'
import useInspectVarsCrud from './use-inspect-vars-crud'
import { getNodeUsedVars } from '../nodes/_base/components/variable/utils'

export const useNodesInteractions = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const { store: workflowHistoryStore } = useWorkflowHistoryStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getAfterNodesInSameBranch } = useWorkflow()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { getWorkflowReadOnly } = useWorkflowReadOnly()
  const { handleSetHelpline } = useHelpline()
  const { handleNodeIterationChildDrag, handleNodeIterationChildrenCopy }
    = useNodeIterationInteractions()
  const { handleNodeLoopChildDrag, handleNodeLoopChildrenCopy }
    = useNodeLoopInteractions()
  const dragNodeStartPosition = useRef({ x: 0, y: 0 } as {
    x: number;
    y: number;
  })
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()

  const { saveStateToHistory, undo, redo } = useWorkflowHistory()

  const handleNodeDragStart = useCallback<NodeDragHandler>(
    (_, node) => {
      workflowStore.setState({ nodeAnimation: false })

      if (getNodesReadOnly()) return

      if (
        node.type === CUSTOM_ITERATION_START_NODE
        || node.type === CUSTOM_NOTE_NODE
      )
        return

      if (
        node.type === CUSTOM_LOOP_START_NODE
        || node.type === CUSTOM_NOTE_NODE
      )
        return

      dragNodeStartPosition.current = {
        x: node.position.x,
        y: node.position.y,
      }
    },
    [workflowStore, getNodesReadOnly],
  )

  const handleNodeDrag = useCallback<NodeDragHandler>(
    (e, node: Node) => {
      if (getNodesReadOnly()) return

      if (node.type === CUSTOM_ITERATION_START_NODE) return

      if (node.type === CUSTOM_LOOP_START_NODE) return

      const { getNodes, setNodes } = store.getState()
      e.stopPropagation()

      const nodes = getNodes()

      const { restrictPosition } = handleNodeIterationChildDrag(node)
      const { restrictPosition: restrictLoopPosition }
        = handleNodeLoopChildDrag(node)

      const { showHorizontalHelpLineNodes, showVerticalHelpLineNodes }
        = handleSetHelpline(node)
      const showHorizontalHelpLineNodesLength
        = showHorizontalHelpLineNodes.length
      const showVerticalHelpLineNodesLength = showVerticalHelpLineNodes.length

      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find(n => n.id === node.id)!

        if (showVerticalHelpLineNodesLength > 0)
          currentNode.position.x = showVerticalHelpLineNodes[0].position.x
        else if (restrictPosition.x !== undefined)
          currentNode.position.x = restrictPosition.x
        else if (restrictLoopPosition.x !== undefined)
          currentNode.position.x = restrictLoopPosition.x
        else currentNode.position.x = node.position.x

        if (showHorizontalHelpLineNodesLength > 0)
          currentNode.position.y = showHorizontalHelpLineNodes[0].position.y
        else if (restrictPosition.y !== undefined)
          currentNode.position.y = restrictPosition.y
        else if (restrictLoopPosition.y !== undefined)
          currentNode.position.y = restrictLoopPosition.y
        else currentNode.position.y = node.position.y
      })
      setNodes(newNodes)
    },
    [
      getNodesReadOnly,
      store,
      handleNodeIterationChildDrag,
      handleNodeLoopChildDrag,
      handleSetHelpline,
    ],
  )

  const handleNodeDragStop = useCallback<NodeDragHandler>(
    (_, node) => {
      const { setHelpLineHorizontal, setHelpLineVertical }
        = workflowStore.getState()

      if (getNodesReadOnly()) return

      const { x, y } = dragNodeStartPosition.current
      if (!(x === node.position.x && y === node.position.y)) {
        setHelpLineHorizontal()
        setHelpLineVertical()
        handleSyncWorkflowDraft()

        if (x !== 0 && y !== 0) {
          // selecting a note will trigger a drag stop event with x and y as 0
          saveStateToHistory(WorkflowHistoryEvent.NodeDragStop, {
            nodeId: node.id,
          })
        }
      }
    },
    [
      workflowStore,
      getNodesReadOnly,
      saveStateToHistory,
      handleSyncWorkflowDraft,
    ],
  )

  const handleNodeEnter = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (getNodesReadOnly()) return

      if (
        node.type === CUSTOM_NOTE_NODE
        || node.type === CUSTOM_ITERATION_START_NODE
      )
        return

      if (
        node.type === CUSTOM_LOOP_START_NODE
        || node.type === CUSTOM_NOTE_NODE
      )
        return

      const { getNodes, setNodes, edges, setEdges } = store.getState()
      const nodes = getNodes()
      const { connectingNodePayload, setEnteringNodePayload }
        = workflowStore.getState()

      if (connectingNodePayload) {
        if (connectingNodePayload.nodeId === node.id) return
        const connectingNode: Node = nodes.find(
          n => n.id === connectingNodePayload.nodeId,
        )!
        const sameLevel = connectingNode.parentId === node.parentId

        if (sameLevel) {
          setEnteringNodePayload({
            nodeId: node.id,
            nodeData: node.data as VariableAssignerNodeType,
          })
          const fromType = connectingNodePayload.handleType

          const newNodes = produce(nodes, (draft) => {
            draft.forEach((n) => {
              if (
                n.id === node.id
                && fromType === 'source'
                && (node.data.type === BlockEnum.VariableAssigner
                  || node.data.type === BlockEnum.VariableAggregator)
              ) {
                if (!node.data.advanced_settings?.group_enabled)
                  n.data._isEntering = true
              }
              if (
                n.id === node.id
                && fromType === 'target'
                && (connectingNode.data.type === BlockEnum.VariableAssigner
                  || connectingNode.data.type === BlockEnum.VariableAggregator)
                && node.data.type !== BlockEnum.IfElse
                && node.data.type !== BlockEnum.QuestionClassifier
              )
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
          if (currentEdge) currentEdge.data._connectedNodeIsHovering = true
        })
      })
      setEdges(newEdges)
    },
    [store, workflowStore, getNodesReadOnly],
  )

  const handleNodeLeave = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (getNodesReadOnly()) return

      if (
        node.type === CUSTOM_NOTE_NODE
        || node.type === CUSTOM_ITERATION_START_NODE
      )
        return

      if (
        node.type === CUSTOM_NOTE_NODE
        || node.type === CUSTOM_LOOP_START_NODE
      )
        return

      const { setEnteringNodePayload } = workflowStore.getState()
      setEnteringNodePayload(undefined)
      const { getNodes, setNodes, edges, setEdges } = store.getState()
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
    },
    [store, workflowStore, getNodesReadOnly],
  )

  const handleNodeSelect = useCallback(
    (
      nodeId: string,
      cancelSelection?: boolean,
      initShowLastRunTab?: boolean,
    ) => {
      if (initShowLastRunTab)
        workflowStore.setState({ initShowLastRunTab: true })
      const { getNodes, setNodes, edges, setEdges } = store.getState()

      const nodes = getNodes()
      const selectedNode = nodes.find(node => node.data.selected)

      if (!cancelSelection && selectedNode?.id === nodeId) return

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          if (node.id === nodeId) node.data.selected = !cancelSelection
          else node.data.selected = false
        })
      })
      setNodes(newNodes)

      const connectedEdges = getConnectedEdges(
        [{ id: nodeId } as Node],
        edges,
      ).map(edge => edge.id)
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
    },
    [store, handleSyncWorkflowDraft],
  )

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === CUSTOM_ITERATION_START_NODE) return
      if (node.type === CUSTOM_LOOP_START_NODE) return
      if (node.data.type === BlockEnum.DataSourceEmpty) return
      handleNodeSelect(node.id)
    },
    [handleNodeSelect],
  )

  const handleNodeConnect = useCallback<OnConnect>(
    ({ source, sourceHandle, target, targetHandle }) => {
      if (source === target) return
      if (getNodesReadOnly()) return

      const { getNodes, setNodes, edges, setEdges } = store.getState()
      const nodes = getNodes()
      const targetNode = nodes.find(node => node.id === target!)
      const sourceNode = nodes.find(node => node.id === source!)

      if (targetNode?.parentId !== sourceNode?.parentId) return

      if (
        sourceNode?.type === CUSTOM_NOTE_NODE
        || targetNode?.type === CUSTOM_NOTE_NODE
      )
        return

      if (
        edges.find(
          edge =>
            edge.source === source
            && edge.sourceHandle === sourceHandle
            && edge.target === target
            && edge.targetHandle === targetHandle,
        )
      )
        return

      const parendNode = nodes.find(node => node.id === targetNode?.parentId)
      const isInIteration
        = parendNode && parendNode.data.type === BlockEnum.Iteration
      const isInLoop = !!parendNode && parendNode.data.type === BlockEnum.Loop

      const newEdge = {
        id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
        type: CUSTOM_EDGE,
        source: source!,
        target: target!,
        sourceHandle,
        targetHandle,
        data: {
          sourceType: nodes.find(node => node.id === source)!.data.type,
          targetType: nodes.find(node => node.id === target)!.data.type,
          isInIteration,
          iteration_id: isInIteration ? targetNode?.parentId : undefined,
          isInLoop,
          loop_id: isInLoop ? targetNode?.parentId : undefined,
        },
        zIndex: targetNode?.parentId
          ? isInIteration
            ? ITERATION_CHILDREN_Z_INDEX
            : LOOP_CHILDREN_Z_INDEX
          : 0,
      }
      const nodesConnectedSourceOrTargetHandleIdsMap
        = getNodesConnectedSourceOrTargetHandleIdsMap(
          [{ type: 'add', edge: newEdge }],
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
      const newEdges = produce(edges, (draft) => {
        draft.push(newEdge)
      })

      setNodes(newNodes)
      setEdges(newEdges)

      handleSyncWorkflowDraft()
      saveStateToHistory(WorkflowHistoryEvent.NodeConnect, {
        nodeId: targetNode?.id,
      })
    },
    [
      getNodesReadOnly,
      store,
      workflowStore,
      handleSyncWorkflowDraft,
      saveStateToHistory,
    ],
  )

  const handleNodeConnectStart = useCallback<OnConnectStart>(
    (_, { nodeId, handleType, handleId }) => {
      if (getNodesReadOnly()) return

      if (nodeId && handleType) {
        const { setConnectingNodePayload } = workflowStore.getState()
        const { getNodes } = store.getState()
        const node = getNodes().find(n => n.id === nodeId)!

        if (node.type === CUSTOM_NOTE_NODE) return

        if (
          node.data.type === BlockEnum.VariableAggregator
          || node.data.type === BlockEnum.VariableAssigner
        )
          if (handleType === 'target') return

        setConnectingNodePayload({
          nodeId,
          nodeType: node.data.type,
          handleType,
          handleId,
        })
      }
    },
    [store, workflowStore, getNodesReadOnly],
  )

  const handleNodeConnectEnd = useCallback<OnConnectEnd>(
    (e: any) => {
      if (getNodesReadOnly()) return

      const {
        connectingNodePayload,
        setConnectingNodePayload,
        enteringNodePayload,
        setEnteringNodePayload,
      } = workflowStore.getState()
      if (connectingNodePayload && enteringNodePayload) {
        const { setShowAssignVariablePopup, hoveringAssignVariableGroupId }
          = workflowStore.getState()
        const { screenToFlowPosition } = reactflow
        const { getNodes, setNodes } = store.getState()
        const nodes = getNodes()
        const fromHandleType = connectingNodePayload.handleType
        const fromHandleId = connectingNodePayload.handleId
        const fromNode = nodes.find(
          n => n.id === connectingNodePayload.nodeId,
        )!
        const toNode = nodes.find(n => n.id === enteringNodePayload.nodeId)!
        const toParentNode = nodes.find(n => n.id === toNode.parentId)

        if (fromNode.parentId !== toNode.parentId) return

        const { x, y } = screenToFlowPosition({ x: e.x, y: e.y })

        if (
          fromHandleType === 'source'
          && (toNode.data.type === BlockEnum.VariableAssigner
            || toNode.data.type === BlockEnum.VariableAggregator)
        ) {
          const groupEnabled = toNode.data.advanced_settings?.group_enabled
          const firstGroupId = toNode.data.advanced_settings?.groups[0].groupId
          let handleId = 'target'

          if (groupEnabled) {
            if (hoveringAssignVariableGroupId)
              handleId = hoveringAssignVariableGroupId
            else handleId = firstGroupId
          }
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
            variableAssignerNodeHandleId: handleId,
            parentNode: toParentNode,
            x: x - toNode.positionAbsolute!.x,
            y: y - toNode.positionAbsolute!.y,
          })
          handleNodeConnect({
            source: fromNode.id,
            sourceHandle: fromHandleId,
            target: toNode.id,
            targetHandle: 'target',
          })
        }
      }
      setConnectingNodePayload(undefined)
      setEnteringNodePayload(undefined)
    },
    [store, handleNodeConnect, getNodesReadOnly, workflowStore, reactflow],
  )

  const { deleteNodeInspectorVars } = useInspectVarsCrud()

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      if (getNodesReadOnly()) return

      const { getNodes, setNodes, edges, setEdges } = store.getState()

      const nodes = getNodes()
      const currentNodeIndex = nodes.findIndex(node => node.id === nodeId)
      const currentNode = nodes[currentNodeIndex]

      if (!currentNode) return

      if (
        nodesMetaDataMap?.[currentNode.data.type as BlockEnum]?.metaData
          .isUndeletable
      )
        return

      deleteNodeInspectorVars(nodeId)
      if (currentNode.data.type === BlockEnum.Iteration) {
        const iterationChildren = nodes.filter(
          node => node.parentId === currentNode.id,
        )

        if (iterationChildren.length) {
          if (currentNode.data._isBundled) {
            iterationChildren.forEach((child) => {
              handleNodeDelete(child.id)
            })
            return handleNodeDelete(nodeId)
          }
          else {
            if (iterationChildren.length === 1) {
              handleNodeDelete(iterationChildren[0].id)
              handleNodeDelete(nodeId)

              return
            }
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

      if (currentNode.data.type === BlockEnum.Loop) {
        const loopChildren = nodes.filter(
          node => node.parentId === currentNode.id,
        )

        if (loopChildren.length) {
          if (currentNode.data._isBundled) {
            loopChildren.forEach((child) => {
              handleNodeDelete(child.id)
            })
            return handleNodeDelete(nodeId)
          }
          else {
            if (loopChildren.length === 1) {
              handleNodeDelete(loopChildren[0].id)
              handleNodeDelete(nodeId)

              return
            }
            const { setShowConfirm, showConfirm } = workflowStore.getState()

            if (!showConfirm) {
              setShowConfirm({
                title: t('workflow.nodes.loop.deleteTitle'),
                desc: t('workflow.nodes.loop.deleteDesc') || '',
                onConfirm: () => {
                  loopChildren.forEach((child) => {
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

      if (currentNode.data.type === BlockEnum.DataSource) {
        const { id } = currentNode
        const { ragPipelineVariables, setRagPipelineVariables }
          = workflowStore.getState()
        if (ragPipelineVariables && setRagPipelineVariables) {
          const newRagPipelineVariables: RAGPipelineVariables = []
          ragPipelineVariables.forEach((variable) => {
            if (variable.belong_to_node_id === id) return
            newRagPipelineVariables.push(variable)
          })
          setRagPipelineVariables(newRagPipelineVariables)
        }
      }

      const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges)
      const nodesConnectedSourceOrTargetHandleIdsMap
        = getNodesConnectedSourceOrTargetHandleIdsMap(
          connectedEdges.map(edge => ({ type: 'remove', edge })),
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

          if (node.id === currentNode.parentId) {
            node.data._children = node.data._children?.filter(
              child => child.nodeId !== nodeId,
            )
          }
        })
        draft.splice(currentNodeIndex, 1)
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        return draft.filter(
          edge =>
            !connectedEdges.find(
              connectedEdge => connectedEdge.id === edge.id,
            ),
        )
      })
      setEdges(newEdges)
      handleSyncWorkflowDraft()

      if (currentNode.type === CUSTOM_NOTE_NODE) {
        saveStateToHistory(WorkflowHistoryEvent.NoteDelete, {
          nodeId: currentNode.id,
        })
      }
      else {
        saveStateToHistory(WorkflowHistoryEvent.NodeDelete, {
          nodeId: currentNode.id,
        })
      }
    },
    [
      getNodesReadOnly,
      store,
      handleSyncWorkflowDraft,
      saveStateToHistory,
      workflowStore,
      t,
      nodesMetaDataMap,
      deleteNodeInspectorVars,
    ],
  )

  const handleNodeAdd = useCallback<OnNodeAdd>(
    (
      {
        nodeType,
        sourceHandle = 'source',
        targetHandle = 'target',
        toolDefaultValue,
      },
      { prevNodeId, prevNodeSourceHandle, nextNodeId, nextNodeTargetHandle },
    ) => {
      if (getNodesReadOnly()) return

      const { getNodes, setNodes, edges, setEdges } = store.getState()
      const nodes = getNodes()
      const nodesWithSameType = nodes.filter(
        node => node.data.type === nodeType,
      )
      const { defaultValue } = nodesMetaDataMap![nodeType]
      const { newNode, newIterationStartNode, newLoopStartNode }
        = generateNewNode({
          type: getNodeCustomTypeByNodeDataType(nodeType),
          data: {
            ...(defaultValue as any),
            title:
              nodesWithSameType.length > 0
                ? `${defaultValue.title} ${nodesWithSameType.length + 1}`
                : defaultValue.title,
            ...toolDefaultValue,
            selected: true,
            _showAddVariablePopup:
              (nodeType === BlockEnum.VariableAssigner
                || nodeType === BlockEnum.VariableAggregator)
              && !!prevNodeId,
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
        const outgoers = getOutgoers(prevNode, nodes, edges).sort(
          (a, b) => a.position.y - b.position.y,
        )
        const lastOutgoer = outgoers[outgoers.length - 1]

        newNode.data._connectedTargetHandleIds
          = nodeType === BlockEnum.DataSource ? [] : [targetHandle]
        newNode.data._connectedSourceHandleIds = []
        newNode.position = {
          x: lastOutgoer
            ? lastOutgoer.position.x
            : prevNode.position.x + prevNode.width! + X_OFFSET,
          y: lastOutgoer
            ? lastOutgoer.position.y + lastOutgoer.height! + Y_OFFSET
            : prevNode.position.y,
        }
        newNode.parentId = prevNode.parentId
        newNode.extent = prevNode.extent

        const parentNode
          = nodes.find(node => node.id === prevNode.parentId) || null
        const isInIteration
          = !!parentNode && parentNode.data.type === BlockEnum.Iteration
        const isInLoop
          = !!parentNode && parentNode.data.type === BlockEnum.Loop

        if (prevNode.parentId) {
          newNode.data.isInIteration = isInIteration
          newNode.data.isInLoop = isInLoop
          if (isInIteration) {
            newNode.data.iteration_id = parentNode.id
            newNode.zIndex = ITERATION_CHILDREN_Z_INDEX
          }
          if (isInLoop) {
            newNode.data.loop_id = parentNode.id
            newNode.zIndex = LOOP_CHILDREN_Z_INDEX
          }
          if (
            isInIteration
            && (newNode.data.type === BlockEnum.Answer
              || newNode.data.type === BlockEnum.Tool
              || newNode.data.type === BlockEnum.Assigner)
          ) {
            const iterNodeData: IterationNodeType = parentNode.data
            iterNodeData._isShowTips = true
          }
          if (
            isInLoop
            && (newNode.data.type === BlockEnum.Answer
              || newNode.data.type === BlockEnum.Tool
              || newNode.data.type === BlockEnum.Assigner)
          ) {
            const iterNodeData: IterationNodeType = parentNode.data
            iterNodeData._isShowTips = true
          }
        }

        let newEdge = null
        if (nodeType !== BlockEnum.DataSource) {
          newEdge = {
            id: `${prevNodeId}-${prevNodeSourceHandle}-${newNode.id}-${targetHandle}`,
            type: CUSTOM_EDGE,
            source: prevNodeId,
            sourceHandle: prevNodeSourceHandle,
            target: newNode.id,
            targetHandle,
            data: {
              sourceType: prevNode.data.type,
              targetType: newNode.data.type,
              isInIteration,
              isInLoop,
              iteration_id: isInIteration ? prevNode.parentId : undefined,
              loop_id: isInLoop ? prevNode.parentId : undefined,
              _connectedNodeIsSelected: true,
            },
            zIndex: prevNode.parentId
              ? isInIteration
                ? ITERATION_CHILDREN_Z_INDEX
                : LOOP_CHILDREN_Z_INDEX
              : 0,
          }
        }

        const nodesConnectedSourceOrTargetHandleIdsMap
          = getNodesConnectedSourceOrTargetHandleIdsMap(
            (newEdge ? [{ type: 'add', edge: newEdge }] : []),
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

            if (
              node.data.type === BlockEnum.Iteration
              && prevNode.parentId === node.id
            ) {
              node.data._children?.push({
                nodeId: newNode.id,
                nodeType: newNode.data.type,
              })
            }

            if (
              node.data.type === BlockEnum.Loop
              && prevNode.parentId === node.id
            ) {
              node.data._children?.push({
                nodeId: newNode.id,
                nodeType: newNode.data.type,
              })
            }
          })
          draft.push(newNode)

          if (newIterationStartNode) draft.push(newIterationStartNode)

          if (newLoopStartNode) draft.push(newLoopStartNode)
        })

        if (
          newNode.data.type === BlockEnum.VariableAssigner
          || newNode.data.type === BlockEnum.VariableAggregator
        ) {
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
          draft.forEach((item) => {
            item.data = {
              ...item.data,
              _connectedNodeIsSelected: false,
            }
          })
          if (newEdge) draft.push(newEdge)
        })

        setNodes(newNodes)
        setEdges(newEdges)
      }
      if (!prevNodeId && nextNodeId) {
        const nextNodeIndex = nodes.findIndex(node => node.id === nextNodeId)
        const nextNode = nodes[nextNodeIndex]!
        if (
          nodeType !== BlockEnum.IfElse
          && nodeType !== BlockEnum.QuestionClassifier
        )
          newNode.data._connectedSourceHandleIds = [sourceHandle]
        newNode.data._connectedTargetHandleIds = []
        newNode.position = {
          x: nextNode.position.x,
          y: nextNode.position.y,
        }
        newNode.parentId = nextNode.parentId
        newNode.extent = nextNode.extent

        const parentNode
          = nodes.find(node => node.id === nextNode.parentId) || null
        const isInIteration
          = !!parentNode && parentNode.data.type === BlockEnum.Iteration
        const isInLoop
          = !!parentNode && parentNode.data.type === BlockEnum.Loop

        if (parentNode && nextNode.parentId) {
          newNode.data.isInIteration = isInIteration
          newNode.data.isInLoop = isInLoop
          if (isInIteration) {
            newNode.data.iteration_id = parentNode.id
            newNode.zIndex = ITERATION_CHILDREN_Z_INDEX
          }
          if (isInLoop) {
            newNode.data.loop_id = parentNode.id
            newNode.zIndex = LOOP_CHILDREN_Z_INDEX
          }
        }

        let newEdge

        if (
          nodeType !== BlockEnum.IfElse
          && nodeType !== BlockEnum.QuestionClassifier
          && nodeType !== BlockEnum.LoopEnd
        ) {
          newEdge = {
            id: `${newNode.id}-${sourceHandle}-${nextNodeId}-${nextNodeTargetHandle}`,
            type: CUSTOM_EDGE,
            source: newNode.id,
            sourceHandle,
            target: nextNodeId,
            targetHandle: nextNodeTargetHandle,
            data: {
              sourceType: newNode.data.type,
              targetType: nextNode.data.type,
              isInIteration,
              isInLoop,
              iteration_id: isInIteration ? nextNode.parentId : undefined,
              loop_id: isInLoop ? nextNode.parentId : undefined,
              _connectedNodeIsSelected: true,
            },
            zIndex: nextNode.parentId
              ? isInIteration
                ? ITERATION_CHILDREN_Z_INDEX
                : LOOP_CHILDREN_Z_INDEX
              : 0,
          }
        }

        let nodesConnectedSourceOrTargetHandleIdsMap: Record<string, any>
        if (newEdge) {
          nodesConnectedSourceOrTargetHandleIdsMap
            = getNodesConnectedSourceOrTargetHandleIdsMap(
              [{ type: 'add', edge: newEdge }],
              nodes,
            )
        }

        const afterNodesInSameBranch = getAfterNodesInSameBranch(nextNodeId!)
        const afterNodesInSameBranchIds = afterNodesInSameBranch.map(
          node => node.id,
        )
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

            if (
              node.data.type === BlockEnum.Iteration
              && nextNode.parentId === node.id
            ) {
              node.data._children?.push({
                nodeId: newNode.id,
                nodeType: newNode.data.type,
              })
            }

            if (
              node.data.type === BlockEnum.Iteration
              && node.data.start_node_id === nextNodeId
            ) {
              node.data.start_node_id = newNode.id
              node.data.startNodeType = newNode.data.type
            }

            if (
              node.data.type === BlockEnum.Loop
              && nextNode.parentId === node.id
            ) {
              node.data._children?.push({
                nodeId: newNode.id,
                nodeType: newNode.data.type,
              })
            }

            if (
              node.data.type === BlockEnum.Loop
              && node.data.start_node_id === nextNodeId
            ) {
              node.data.start_node_id = newNode.id
              node.data.startNodeType = newNode.data.type
            }
          })
          draft.push(newNode)
          if (newIterationStartNode) draft.push(newIterationStartNode)
          if (newLoopStartNode) draft.push(newLoopStartNode)
        })
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

          setNodes(newNodes)
          setEdges(newEdges)
        }
        else {
          setNodes(newNodes)
        }
      }
      if (prevNodeId && nextNodeId) {
        const prevNode = nodes.find(node => node.id === prevNodeId)!
        const nextNode = nodes.find(node => node.id === nextNodeId)!

        newNode.data._connectedTargetHandleIds
          = nodeType === BlockEnum.DataSource ? [] : [targetHandle]
        newNode.data._connectedSourceHandleIds = [sourceHandle]
        newNode.position = {
          x: nextNode.position.x,
          y: nextNode.position.y,
        }
        newNode.parentId = prevNode.parentId
        newNode.extent = prevNode.extent

        const parentNode
          = nodes.find(node => node.id === prevNode.parentId) || null
        const isInIteration
          = !!parentNode && parentNode.data.type === BlockEnum.Iteration
        const isInLoop
          = !!parentNode && parentNode.data.type === BlockEnum.Loop

        if (parentNode && prevNode.parentId) {
          newNode.data.isInIteration = isInIteration
          newNode.data.isInLoop = isInLoop
          if (isInIteration) {
            newNode.data.iteration_id = parentNode.id
            newNode.zIndex = ITERATION_CHILDREN_Z_INDEX
          }
          if (isInLoop) {
            newNode.data.loop_id = parentNode.id
            newNode.zIndex = LOOP_CHILDREN_Z_INDEX
          }
        }

        const currentEdgeIndex = edges.findIndex(
          edge => edge.source === prevNodeId && edge.target === nextNodeId,
        )
        let newPrevEdge = null

        if (nodeType !== BlockEnum.DataSource) {
          newPrevEdge = {
            id: `${prevNodeId}-${prevNodeSourceHandle}-${newNode.id}-${targetHandle}`,
            type: CUSTOM_EDGE,
            source: prevNodeId,
            sourceHandle: prevNodeSourceHandle,
            target: newNode.id,
            targetHandle,
            data: {
              sourceType: prevNode.data.type,
              targetType: newNode.data.type,
              isInIteration,
              isInLoop,
              iteration_id: isInIteration ? prevNode.parentId : undefined,
              loop_id: isInLoop ? prevNode.parentId : undefined,
              _connectedNodeIsSelected: true,
            },
            zIndex: prevNode.parentId
              ? isInIteration
                ? ITERATION_CHILDREN_Z_INDEX
                : LOOP_CHILDREN_Z_INDEX
              : 0,
          }
        }

        let newNextEdge: Edge | null = null

        const nextNodeParentNode
          = nodes.find(node => node.id === nextNode.parentId) || null
        const isNextNodeInIteration
          = !!nextNodeParentNode
          && nextNodeParentNode.data.type === BlockEnum.Iteration
        const isNextNodeInLoop
          = !!nextNodeParentNode
          && nextNodeParentNode.data.type === BlockEnum.Loop

        if (
          nodeType !== BlockEnum.IfElse
          && nodeType !== BlockEnum.QuestionClassifier
          && nodeType !== BlockEnum.LoopEnd
        ) {
          newNextEdge = {
            id: `${newNode.id}-${sourceHandle}-${nextNodeId}-${nextNodeTargetHandle}`,
            type: CUSTOM_EDGE,
            source: newNode.id,
            sourceHandle,
            target: nextNodeId,
            targetHandle: nextNodeTargetHandle,
            data: {
              sourceType: newNode.data.type,
              targetType: nextNode.data.type,
              isInIteration: isNextNodeInIteration,
              isInLoop: isNextNodeInLoop,
              iteration_id: isNextNodeInIteration
                ? nextNode.parentId
                : undefined,
              loop_id: isNextNodeInLoop ? nextNode.parentId : undefined,
              _connectedNodeIsSelected: true,
            },
            zIndex: nextNode.parentId
              ? isNextNodeInIteration
                ? ITERATION_CHILDREN_Z_INDEX
                : LOOP_CHILDREN_Z_INDEX
              : 0,
          }
        }
        const nodesConnectedSourceOrTargetHandleIdsMap
          = getNodesConnectedSourceOrTargetHandleIdsMap(
            [
              { type: 'remove', edge: edges[currentEdgeIndex] },
              ...(newPrevEdge ? [{ type: 'add', edge: newPrevEdge }] : []),
              ...(newNextEdge ? [{ type: 'add', edge: newNextEdge }] : []),
            ],
            [...nodes, newNode],
          )

        const afterNodesInSameBranch = getAfterNodesInSameBranch(nextNodeId!)
        const afterNodesInSameBranchIds = afterNodesInSameBranch.map(
          node => node.id,
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
            if (afterNodesInSameBranchIds.includes(node.id))
              node.position.x += NODE_WIDTH_X_OFFSET

            if (
              node.data.type === BlockEnum.Iteration
              && prevNode.parentId === node.id
            ) {
              node.data._children?.push({
                nodeId: newNode.id,
                nodeType: newNode.data.type,
              })
            }
            if (
              node.data.type === BlockEnum.Loop
              && prevNode.parentId === node.id
            ) {
              node.data._children?.push({
                nodeId: newNode.id,
                nodeType: newNode.data.type,
              })
            }
          })
          draft.push(newNode)
          if (newIterationStartNode) draft.push(newIterationStartNode)
          if (newLoopStartNode) draft.push(newLoopStartNode)
        })
        setNodes(newNodes)
        if (
          newNode.data.type === BlockEnum.VariableAssigner
          || newNode.data.type === BlockEnum.VariableAggregator
        ) {
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
          if (newPrevEdge) draft.push(newPrevEdge)

          if (newNextEdge) draft.push(newNextEdge)
        })
        setEdges(newEdges)
      }
      handleSyncWorkflowDraft()
      saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: newNode.id })
    },
    [
      getNodesReadOnly,
      store,
      handleSyncWorkflowDraft,
      saveStateToHistory,
      workflowStore,
      getAfterNodesInSameBranch,
      nodesMetaDataMap,
    ],
  )

  const handleNodeChange = useCallback(
    (
      currentNodeId: string,
      nodeType: BlockEnum,
      sourceHandle: string,
      toolDefaultValue?: ToolDefaultValue | DataSourceDefaultValue,
    ) => {
      if (getNodesReadOnly()) return

      const { getNodes, setNodes, edges, setEdges } = store.getState()
      const nodes = getNodes()
      const currentNode = nodes.find(node => node.id === currentNodeId)!
      const connectedEdges = getConnectedEdges([currentNode], edges)
      const nodesWithSameType = nodes.filter(
        node => node.data.type === nodeType,
      )
      const { defaultValue } = nodesMetaDataMap![nodeType]
      const {
        newNode: newCurrentNode,
        newIterationStartNode,
        newLoopStartNode,
      } = generateNewNode({
        type: getNodeCustomTypeByNodeDataType(nodeType),
        data: {
          ...(defaultValue as any),
          title:
            nodesWithSameType.length > 0
              ? `${defaultValue.title} ${nodesWithSameType.length + 1}`
              : defaultValue.title,
          ...toolDefaultValue,
          _connectedSourceHandleIds: [],
          _connectedTargetHandleIds: [],
          selected: currentNode.data.selected,
          isInIteration: currentNode.data.isInIteration,
          isInLoop: currentNode.data.isInLoop,
          iteration_id: currentNode.data.iteration_id,
          loop_id: currentNode.data.loop_id,
        },
        position: {
          x: currentNode.position.x,
          y: currentNode.position.y,
        },
        parentId: currentNode.parentId,
        extent: currentNode.extent,
        zIndex: currentNode.zIndex,
      })
      const nodesConnectedSourceOrTargetHandleIdsMap
        = getNodesConnectedSourceOrTargetHandleIdsMap(
          connectedEdges.map(edge => ({ type: 'remove', edge })),
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
        if (newIterationStartNode) draft.push(newIterationStartNode)
        if (newLoopStartNode) draft.push(newLoopStartNode)
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        const filtered = draft.filter(
          edge =>
            !connectedEdges.find(
              connectedEdge => connectedEdge.id === edge.id,
            ),
        )

        return filtered
      })
      setEdges(newEdges)
      handleSyncWorkflowDraft()

      saveStateToHistory(WorkflowHistoryEvent.NodeChange, {
        nodeId: currentNodeId,
      })
    },
    [
      getNodesReadOnly,
      store,
      handleSyncWorkflowDraft,
      saveStateToHistory,
      nodesMetaDataMap,
    ],
  )

  const handleNodesCancelSelected = useCallback(() => {
    const { getNodes, setNodes } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data.selected = false
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleNodeContextMenu = useCallback(
    (e: MouseEvent, node: Node) => {
      if (
        node.type === CUSTOM_NOTE_NODE
        || node.type === CUSTOM_ITERATION_START_NODE
      )
        return

      if (
        node.type === CUSTOM_NOTE_NODE
        || node.type === CUSTOM_LOOP_START_NODE
      )
        return

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
    },
    [workflowStore, handleNodeSelect],
  )

  const handleNodesCopy = useCallback(
    (nodeId?: string) => {
      if (getNodesReadOnly()) return

      const { setClipboardElements } = workflowStore.getState()

      const { getNodes } = store.getState()

      const nodes = getNodes()

      if (nodeId) {
        // If nodeId is provided, copy that specific node
        const nodeToCopy = nodes.find(
          node =>
            node.id === nodeId
            && node.data.type !== BlockEnum.Start
            && node.type !== CUSTOM_ITERATION_START_NODE
            && node.type !== CUSTOM_LOOP_START_NODE
            && node.data.type !== BlockEnum.LoopEnd
            && node.data.type !== BlockEnum.KnowledgeBase
            && node.data.type !== BlockEnum.DataSourceEmpty,
        )
        if (nodeToCopy) setClipboardElements([nodeToCopy])
      }
      else {
        // If no nodeId is provided, fall back to the current behavior
        const bundledNodes = nodes.filter((node) => {
          if (!node.data._isBundled) return false
          if (node.type === CUSTOM_NOTE_NODE) return true
          const { metaData } = nodesMetaDataMap![node.data.type as BlockEnum]
          if (metaData.isSingleton) return false
          return !node.data.isInIteration && !node.data.isInLoop
        })

        if (bundledNodes.length) {
          setClipboardElements(bundledNodes)
          return
        }

        const selectedNode = nodes.find((node) => {
          if (!node.data.selected) return false
          if (node.type === CUSTOM_NOTE_NODE) return true
          const { metaData } = nodesMetaDataMap![node.data.type as BlockEnum]
          return !metaData.isSingleton
        })

        if (selectedNode) setClipboardElements([selectedNode])
      }
    },
    [getNodesReadOnly, store, workflowStore],
  )

  const handleNodesPaste = useCallback(() => {
    if (getNodesReadOnly()) return

    const { clipboardElements, mousePosition } = workflowStore.getState()

    const { getNodes, setNodes, edges, setEdges } = store.getState()

    const nodesToPaste: Node[] = []
    const edgesToPaste: Edge[] = []
    const nodes = getNodes()

    if (clipboardElements.length) {
      const { x, y } = getTopLeftNodePosition(clipboardElements)
      const { screenToFlowPosition } = reactflow
      const currentPosition = screenToFlowPosition({
        x: mousePosition.pageX,
        y: mousePosition.pageY,
      })
      const offsetX = currentPosition.x - x
      const offsetY = currentPosition.y - y
      let idMapping: Record<string, string> = {}
      clipboardElements.forEach((nodeToPaste, index) => {
        const nodeType = nodeToPaste.data.type

        const { newNode, newIterationStartNode, newLoopStartNode }
          = generateNewNode({
            type: nodeToPaste.type,
            data: {
              ...(nodeToPaste.type !== CUSTOM_NOTE_NODE && nodesMetaDataMap![nodeType].defaultValue),
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
        // This new node is movable and can be placed anywhere
        let newChildren: Node[] = []
        if (nodeToPaste.data.type === BlockEnum.Iteration) {
          newIterationStartNode!.parentId = newNode.id;
          (newNode.data as IterationNodeType).start_node_id
            = newIterationStartNode!.id

          const oldIterationStartNode = nodes.find(
            n =>
              n.parentId === nodeToPaste.id
              && n.type === CUSTOM_ITERATION_START_NODE,
          )
          idMapping[oldIterationStartNode!.id] = newIterationStartNode!.id

          const { copyChildren, newIdMapping }
            = handleNodeIterationChildrenCopy(
              nodeToPaste.id,
              newNode.id,
              idMapping,
            )
          newChildren = copyChildren
          idMapping = newIdMapping
          newChildren.forEach((child) => {
            newNode.data._children?.push({
              nodeId: child.id,
              nodeType: child.data.type,
            })
          })
          newChildren.push(newIterationStartNode!)
        }
        else if (nodeToPaste.data.type === BlockEnum.Loop) {
          newLoopStartNode!.parentId = newNode.id;
          (newNode.data as LoopNodeType).start_node_id = newLoopStartNode!.id

          newChildren = handleNodeLoopChildrenCopy(nodeToPaste.id, newNode.id)
          newChildren.forEach((child) => {
            newNode.data._children?.push({
              nodeId: child.id,
              nodeType: child.data.type,
            })
          })
          newChildren.push(newLoopStartNode!)
        }
        else {
          // single node paste
          const selectedNode = nodes.find(node => node.selected)
          if (selectedNode) {
            const commonNestedDisallowPasteNodes = [
              // end node only can be placed outermost layer
              BlockEnum.End,
            ]

            // handle disallow paste node
            if (commonNestedDisallowPasteNodes.includes(nodeToPaste.data.type))
              return

            // handle paste to nested block
            if (selectedNode.data.type === BlockEnum.Iteration) {
              newNode.data.isInIteration = true
              newNode.data.iteration_id = selectedNode.data.iteration_id
              newNode.parentId = selectedNode.id
              newNode.positionAbsolute = {
                x: newNode.position.x,
                y: newNode.position.y,
              }
              // set position base on parent node
              newNode.position = getNestedNodePosition(newNode, selectedNode)
            }
            else if (selectedNode.data.type === BlockEnum.Loop) {
              newNode.data.isInLoop = true
              newNode.data.loop_id = selectedNode.data.loop_id
              newNode.parentId = selectedNode.id
              newNode.positionAbsolute = {
                x: newNode.position.x,
                y: newNode.position.y,
              }
              // set position base on parent node
              newNode.position = getNestedNodePosition(newNode, selectedNode)
            }
          }
        }

        nodesToPaste.push(newNode)

        if (newChildren.length) nodesToPaste.push(...newChildren)
      })

      // only handle edge when paste nested block
      edges.forEach((edge) => {
        const sourceId = idMapping[edge.source]
        const targetId = idMapping[edge.target]

        if (sourceId && targetId) {
          const newEdge: Edge = {
            ...edge,
            id: `${sourceId}-${edge.sourceHandle}-${targetId}-${edge.targetHandle}`,
            source: sourceId,
            target: targetId,
            data: {
              ...edge.data,
              _connectedNodeIsSelected: false,
            },
          }
          edgesToPaste.push(newEdge)
        }
      })

      setNodes([...nodes, ...nodesToPaste])
      setEdges([...edges, ...edgesToPaste])
      saveStateToHistory(WorkflowHistoryEvent.NodePaste, {
        nodeId: nodesToPaste?.[0]?.id,
      })
      handleSyncWorkflowDraft()
    }
  }, [
    getNodesReadOnly,
    workflowStore,
    store,
    reactflow,
    saveStateToHistory,
    handleSyncWorkflowDraft,
    handleNodeIterationChildrenCopy,
    handleNodeLoopChildrenCopy,
    nodesMetaDataMap,
  ])

  const handleNodesDuplicate = useCallback(
    (nodeId?: string) => {
      if (getNodesReadOnly()) return

      handleNodesCopy(nodeId)
      handleNodesPaste()
    },
    [getNodesReadOnly, handleNodesCopy, handleNodesPaste],
  )

  const handleNodesDelete = useCallback(() => {
    if (getNodesReadOnly()) return

    const { getNodes, edges } = store.getState()

    const nodes = getNodes()
    const bundledNodes = nodes.filter(
      node => node.data._isBundled && node.data.type !== BlockEnum.Start,
    )

    if (bundledNodes.length) {
      bundledNodes.forEach(node => handleNodeDelete(node.id))

      return
    }

    const edgeSelected = edges.some(edge => edge.selected)
    if (edgeSelected) return

    const selectedNode = nodes.find(
      node => node.data.selected && node.data.type !== BlockEnum.Start,
    )

    if (selectedNode) handleNodeDelete(selectedNode.id)
  }, [store, getNodesReadOnly, handleNodeDelete])

  const handleNodeResize = useCallback(
    (nodeId: string, params: ResizeParamsWithDirection) => {
      if (getNodesReadOnly()) return

      const { getNodes, setNodes } = store.getState()
      const { x, y, width, height } = params

      const nodes = getNodes()
      const currentNode = nodes.find(n => n.id === nodeId)!
      const childrenNodes = nodes.filter(n =>
        currentNode.data._children?.find((c: any) => c.nodeId === n.id),
      )
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
          if (
            n.position.y + n.height!
            > bottomNode.position.y + bottomNode.height!
          )
            bottomNode = n
        }
        else {
          bottomNode = n
        }
      })

      if (rightNode! && bottomNode!) {
        const parentNode = nodes.find(n => n.id === rightNode.parentId)
        const paddingMap
          = parentNode?.data.type === BlockEnum.Iteration
            ? ITERATION_PADDING
            : LOOP_PADDING

        if (width < rightNode!.position.x + rightNode.width! + paddingMap.right)
          return
        if (
          height
          < bottomNode.position.y + bottomNode.height! + paddingMap.bottom
        )
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
      saveStateToHistory(WorkflowHistoryEvent.NodeResize, { nodeId })
    },
    [getNodesReadOnly, store, handleSyncWorkflowDraft, saveStateToHistory],
  )

  const handleNodeDisconnect = useCallback(
    (nodeId: string) => {
      if (getNodesReadOnly()) return

      const { getNodes, setNodes, edges, setEdges } = store.getState()
      const nodes = getNodes()
      const currentNode = nodes.find(node => node.id === nodeId)!
      const connectedEdges = getConnectedEdges([currentNode], edges)
      const nodesConnectedSourceOrTargetHandleIdsMap
        = getNodesConnectedSourceOrTargetHandleIdsMap(
          connectedEdges.map(edge => ({ type: 'remove', edge })),
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
        return draft.filter(
          edge =>
            !connectedEdges.find(
              connectedEdge => connectedEdge.id === edge.id,
            ),
        )
      })
      setEdges(newEdges)
      handleSyncWorkflowDraft()
      saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
    },
    [store, getNodesReadOnly, handleSyncWorkflowDraft, saveStateToHistory],
  )

  const handleHistoryBack = useCallback(() => {
    if (getNodesReadOnly() || getWorkflowReadOnly()) return

    const { setEdges, setNodes } = store.getState()
    undo()

    const { edges, nodes } = workflowHistoryStore.getState()
    if (edges.length === 0 && nodes.length === 0) return

    setEdges(edges)
    setNodes(nodes)
  }, [
    store,
    undo,
    workflowHistoryStore,
    getNodesReadOnly,
    getWorkflowReadOnly,
  ])

  const handleHistoryForward = useCallback(() => {
    if (getNodesReadOnly() || getWorkflowReadOnly()) return

    const { setEdges, setNodes } = store.getState()
    redo()

    const { edges, nodes } = workflowHistoryStore.getState()
    if (edges.length === 0 && nodes.length === 0) return

    setEdges(edges)
    setNodes(nodes)
  }, [
    redo,
    store,
    workflowHistoryStore,
    getNodesReadOnly,
    getWorkflowReadOnly,
  ])

  const [isDimming, setIsDimming] = useState(false)
  /** Add opacity-30 to all nodes except the nodeId */
  const dimOtherNodes = useCallback(() => {
    if (isDimming) return
    const { getNodes, setNodes, edges, setEdges } = store.getState()
    const nodes = getNodes()

    const selectedNode = nodes.find(n => n.data.selected)
    if (!selectedNode) return

    setIsDimming(true)

    // const workflowNodes = useStore(s => s.getNodes())
    const workflowNodes = nodes

    const usedVars = getNodeUsedVars(selectedNode)
    const dependencyNodes: Node[] = []
    usedVars.forEach((valueSelector) => {
      const node = workflowNodes.find(node => node.id === valueSelector?.[0])
      if (node)
        if (!dependencyNodes.includes(node)) dependencyNodes.push(node)
    })

    const outgoers = getOutgoers(selectedNode as Node, nodes as Node[], edges)
    for (let currIdx = 0; currIdx < outgoers.length; currIdx++) {
      const node = outgoers[currIdx]
      const outgoersForNode = getOutgoers(node, nodes as Node[], edges)
      outgoersForNode.forEach((item) => {
        const existed = outgoers.some(v => v.id === item.id)
        if (!existed) outgoers.push(item)
      })
    }

    const dependentNodes: Node[] = []
    outgoers.forEach((node) => {
      const usedVars = getNodeUsedVars(node)
      const used = usedVars.some(v => v?.[0] === selectedNode.id)
      if (used) {
        const existed = dependentNodes.some(v => v.id === node.id)
        if (!existed) dependentNodes.push(node)
      }
    })

    const dimNodes = [...dependencyNodes, ...dependentNodes, selectedNode]

    const newNodes = produce(nodes, (draft) => {
      draft.forEach((n) => {
        const dimNode = dimNodes.find(v => v.id === n.id)
        if (!dimNode) n.data._dimmed = true
      })
    })

    setNodes(newNodes)

    const tempEdges: Edge[] = []

    dependencyNodes.forEach((n) => {
      tempEdges.push({
        id: `tmp_${n.id}-source-${selectedNode.id}-target`,
        type: CUSTOM_EDGE,
        source: n.id,
        sourceHandle: 'source_tmp',
        target: selectedNode.id,
        targetHandle: 'target_tmp',
        animated: true,
        data: {
          sourceType: n.data.type,
          targetType: selectedNode.data.type,
          _isTemp: true,
          _connectedNodeIsHovering: true,
        },
      })
    })
    dependentNodes.forEach((n) => {
      tempEdges.push({
        id: `tmp_${selectedNode.id}-source-${n.id}-target`,
        type: CUSTOM_EDGE,
        source: selectedNode.id,
        sourceHandle: 'source_tmp',
        target: n.id,
        targetHandle: 'target_tmp',
        animated: true,
        data: {
          sourceType: selectedNode.data.type,
          targetType: n.data.type,
          _isTemp: true,
          _connectedNodeIsHovering: true,
        },
      })
    })

    const newEdges = produce(edges, (draft) => {
      draft.forEach((e) => {
        e.data._dimmed = true
      })
      draft.push(...tempEdges)
    })
    setEdges(newEdges)
  }, [isDimming, store])

  /** Restore all nodes to full opacity */
  const undimAllNodes = useCallback(() => {
    const { getNodes, setNodes, edges, setEdges } = store.getState()
    const nodes = getNodes()
    setIsDimming(false)

    const newNodes = produce(nodes, (draft) => {
      draft.forEach((n) => {
        n.data._dimmed = false
      })
    })

    setNodes(newNodes)

    const newEdges = produce(
      edges.filter(e => !e.data._isTemp),
      (draft) => {
        draft.forEach((e) => {
          e.data._dimmed = false
        })
      },
    )
    setEdges(newEdges)
  }, [store])

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
    handleNodesCancelSelected,
    handleNodeContextMenu,
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
    handleNodeResize,
    handleNodeDisconnect,
    handleHistoryBack,
    handleHistoryForward,
    dimOtherNodes,
    undimAllNodes,
  }
}
