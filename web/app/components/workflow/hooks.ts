import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useDebounceFn } from 'ahooks'
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
import {
  NodeRunningStatus,
  WorkflowRunningStatus,
} from './types'
import {
  NODES_EXTRA_DATA,
  NODES_INITIAL_DATA,
} from './constants'
import { getLayoutByDagre } from './utils'
import { useStore } from './store'
import type { ToolDefaultValue } from './block-selector/types'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ssePost } from '@/service/base'
import type { IOtherOptions } from '@/service/base'

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

export const useNodesExtraData = () => {
  const { t } = useTranslation()

  return produce(NODES_EXTRA_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].about = t(`workflow.blocksAbout.${key}`)
    })
  })
}

export const useWorkflow = () => {
  const store = useStoreApi()
  const reactFlow = useReactFlow()
  const nodesInitialData = useNodesInitialData()
  const featuresStore = useFeaturesStore()

  const shouldDebouncedSyncWorkflowDraft = () => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactFlow
    const appId = useAppStore.getState().appDetail?.id

    if (appId) {
      const features = featuresStore!.getState().features
      const nodes = produce(getNodes(), (draft) => {
        draft.forEach((node) => {
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_'))
              delete node.data[key]
          })
        })
      })
      syncWorkflowDraft({
        url: `/apps/${appId}/workflows/draft`,
        params: {
          graph: {
            nodes,
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
  }

  const { run: handleSyncWorkflowDraft } = useDebounceFn(shouldDebouncedSyncWorkflowDraft, {
    wait: 2000,
    trailing: true,
  })

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
    const {
      runningStatus,
      setIsDragging,
    } = useStore.getState()

    if (!runningStatus)
      setIsDragging(true)
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

  const handleNodeDragStop = useCallback<NodeDragHandler>(() => {
    const {
      runningStatus,
      setIsDragging,
      setHelpLineHorizontal,
      setHelpLineVertical,
    } = useStore.getState()

    if (runningStatus)
      return

    setIsDragging(false)
    setHelpLineHorizontal()
    setHelpLineVertical()
    handleSyncWorkflowDraft()
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

    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach(node => node.data.selected = false)
      const selectedNode = draft.find(node => node.id === nodeId)!

      if (!cancelSelection)
        selectedNode.data.selected = true
    })
    setNodes(newNodes)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    const {
      runningStatus,
      isDragging,
    } = useStore.getState()

    if (runningStatus || isDragging)
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
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

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
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(node => node.id === id)!

      currentNode.data = { ...currentNode.data, ...data }
    })
    setNodes(newNodes)
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
    const currentNode = nodes.find(node => node.id === currentNodeId)!
    const nextNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: {
        ...nodesInitialData[nodeType],
        ...(toolDefaultValue || {}),
        selected: true,
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
        node.data.selected = false
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

  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

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
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

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
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

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
    const { runningStatus } = useStore.getState()

    if (runningStatus)
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
  }, [store])

  const handleRunInit = useCallback((shouldClear?: boolean) => {
    useStore.setState({ runningStatus: shouldClear ? undefined : WorkflowRunningStatus.Waiting })
    const { setNodes, getNodes } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        node.data._runningStatus = shouldClear ? undefined : NodeRunningStatus.Waiting
      })
    })
    setNodes(newNodes)
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

    handleRunInit,
  }
}

export const useWorkflowRun = () => {
  const store = useStoreApi()

  const run = useCallback((params: any, callback?: IOtherOptions) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const appDetail = useAppStore.getState().appDetail

    let url = ''
    if (appDetail?.mode === 'advanced-chat')
      url = `/apps/${appDetail.id}/advanced-chat/workflows/draft/run`

    if (appDetail?.mode === 'workflow')
      url = `/apps/${appDetail.id}/workflows/draft/run`

    ssePost(
      url,
      {
        body: params,
      },
      {
        onWorkflowStarted: ({ task_id, workflow_run_id }) => {
          useStore.setState({ runningStatus: WorkflowRunningStatus.Running })
          useStore.setState({ taskId: task_id })
          useStore.setState({ workflowRunId: workflow_run_id })
          const newNodes = produce(getNodes(), (draft) => {
            draft.forEach((node) => {
              node.data._runningStatus = NodeRunningStatus.Waiting
            })
          })
          setNodes(newNodes)
        },
        onWorkflowFinished: ({ data }) => {
          useStore.setState({ runningStatus: data.status as WorkflowRunningStatus })
        },
        onNodeStarted: ({ data }) => {
          const newNodes = produce(getNodes(), (draft) => {
            const currentNode = draft.find(node => node.id === data.node_id)!

            currentNode.data._runningStatus = NodeRunningStatus.Running
          })
          setNodes(newNodes)
        },
        onNodeFinished: ({ data }) => {
          const newNodes = produce(getNodes(), (draft) => {
            const currentNode = draft.find(node => node.id === data.node_id)!

            currentNode.data._runningStatus = data.status
          })
          setNodes(newNodes)
        },
        ...callback,
      },
    )
  }, [store])

  return run
}
