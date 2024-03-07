import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  NodeDragHandler,
  NodeMouseHandler,
  OnConnect,
  OnEdgesChange,
  Viewport,
} from 'reactflow'
import {
  Position,
  getConnectedEdges,
  getIncomers,
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import type {
  BlockEnum,
  Node,
} from './types'
import { NODES_INITIAL_DATA } from './constants'
import { getLayoutByDagre } from './utils'
import { useStore } from './store'
import type { ToolDefaultValue } from './block-selector/types'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useStore as useAppStore } from '@/app/components/app/store'

export const useIsChatMode = () => {
  const appDetail = useAppStore(s => s.appDetail)

  return appDetail?.mode === 'advanced-chat'
}

export const useNodesInitialData = () => {
  const { t } = useTranslation()

  return produce(NODES_INITIAL_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].title = t(`workflow.blocks.${key}`)
    })
  })
}

export const useWorkflow = () => {
  const store = useStoreApi()
  const reactFlow = useReactFlow()
  const nodesInitialData = useNodesInitialData()
  const featuresStore = useFeaturesStore()

  const handleSyncWorkflowDraft = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactFlow
    const appId = useAppStore.getState().appDetail?.id

    if (appId) {
      const features = featuresStore!.getState().features
      syncWorkflowDraft({
        url: `/apps/${appId}/workflows/draft`,
        params: {
          graph: {
            nodes: getNodes(),
            edges,
            viewport: getViewport(),
          },
          features: {
            opening_statement: features.opening.opening_statement,
            suggested_questions: features.opening.suggested_questions,
            suggested_questions_after_answer: features.suggested,
            text_to_speech: features.text2speech,
            speech_to_text: features.speech2text,
            retriever_resource: features.citation,
            sensitive_word_avoidance: features.moderation,
            annotation_reply: features.annotation,
          },
        },
      }).then((res) => {
        useStore.setState({ draftUpdatedAt: res.updated_at })
      })
    }
  }, [store, reactFlow, featuresStore])

  const handleLayout = useCallback(async () => {
    const {
      getNodes,
      edges,
      setNodes,
    } = store.getState()

    const layout = getLayoutByDagre(getNodes(), edges)

    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        const nodeWithPosition = layout.node(node.id)
        node.position = {
          x: nodeWithPosition.x,
          y: nodeWithPosition.y,
        }
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleSetViewport = useCallback((viewPort: Viewport) => {
    reactFlow.setViewport(viewPort)
  }, [reactFlow])

  const handleNodeDragStart = useCallback<NodeDragHandler>(() => {
    useStore.getState().setIsDragging(true)
  }, [])

  const handleNodeDrag = useCallback<NodeDragHandler>((e, node: Node) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    // const { setHelpLine } = useStore.getState()
    e.stopPropagation()

    const nodes = getNodes()

    // const showVerticalHelpLineNodes = nodes.filter((n) => {
    //   if (
    //     n.position.x === node.position.x
    //     || n.position.x + n.width! === node.position.x
    //     || n.position.x === node.position.x + node.width!
    //   )
    //     return true

    //   return false
    // })
    // const showHorizontalHelpLineNodes = nodes.filter((n) => {
    //   if (
    //     n.position.y === node.position.y
    //     || n.position.y === node.position.y + node.height!
    //     || n.position.y + n.height! === node.position.y
    //     || n.position.y + n.height! === node.position.y + node.height!
    //   )
    //     return true

    //   return false
    // })

    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(n => n.id === node.id)!

      currentNode.position = node.position
    })

    setNodes(newNodes)
  }, [store])

  const handleNodeDragStop = useCallback<NodeDragHandler>(() => {
    const {
      setIsDragging,
      setHelpLine,
    } = useStore.getState()
    setIsDragging(false)
    setHelpLine()
    handleSyncWorkflowDraft()
  }, [handleSyncWorkflowDraft])

  const handleNodeEnter = useCallback<NodeMouseHandler>((_, node) => {
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
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const selectedNode = nodes.find(node => node.data._selected)

    if (!cancelSelection && selectedNode?.id === nodeId)
      return

    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach(node => node.data._selected = false)
      const selectedNode = draft.find(node => node.id === nodeId)!

      if (!cancelSelection)
        selectedNode.data._selected = true
    })
    setNodes(newNodes)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    if (useStore.getState().isDragging)
      return

    handleNodeSelect(node.id)
  }, [handleNodeSelect])

  const handleNodeConnect = useCallback<OnConnect>(({
    source,
    sourceHandle,
    target,
    targetHandle,
  }) => {
    const {
      edges,
      setEdges,
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      const filtered = draft.filter(edge => edge.source !== source && edge.target !== target)

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
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()

    const newNodes = produce(getNodes(), (draft) => {
      const index = draft.findIndex(node => node.id === nodeId)

      if (index > -1)
        draft.splice(index, 1)
    })
    setNodes(newNodes)
    const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges)
    const newEdges = produce(edges, (draft) => {
      return draft.filter(edge => !connectedEdges.find(connectedEdge => connectedEdge.id === edge.id))
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleNodeDataUpdate = useCallback(({ id, data }: { id: string; data: Record<string, any> }) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(node => node.id === id)!

      currentNode.data = { ...currentNode.data, ...data }
    })
    setNodes(newNodes)
  }, [store])

  const handleNodeAddNext = useCallback((
    currentNodeId: string,
    nodeType: BlockEnum,
    sourceHandle: string,
    toolDefaultValue?: ToolDefaultValue,
  ) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === currentNodeId)!
    const nextNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: {
        ...nodesInitialData[nodeType],
        ...(toolDefaultValue || {}),
        _selected: true,
      },
      position: {
        x: currentNode.position.x + 304,
        y: currentNode.position.y,
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
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data._selected = false
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

  const handleNodeChange = useCallback((
    currentNodeId: string,
    nodeType: BlockEnum,
    sourceHandle: string,
    toolDefaultValue?: ToolDefaultValue,
  ) => {
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
        _selected: currentNode.data._selected,
      },
      position: {
        x: currentNode.position.x,
        y: currentNode.position.y,
      },
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

  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data = { ...currentEdge.data, _hovering: true }
    })
    setEdges(newEdges)
  }, [store])

  const handleEdgeLeave = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data = { ...currentEdge.data, _hovering: false }
    })
    setEdges(newEdges)
  }, [store])

  const handleEdgeDelete = useCallback(() => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const index = draft.findIndex(edge => edge.selected)

      if (index > -1)
        draft.splice(index, 1)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleEdgesChange = useCallback<OnEdgesChange>((changes) => {
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
  }, [store])

  return {
    handleSyncWorkflowDraft,
    handleLayout,
    handleSetViewport,

    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleNodeEnter,
    handleNodeLeave,
    handleNodeSelect,
    handleNodeClick,
    handleNodeConnect,
    handleNodeDelete,
    handleNodeDataUpdate,
    handleNodeAddNext,
    handleNodeChange,

    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDelete,
    handleEdgesChange,
  }
}
