'use client'

import type { FC } from 'react'
import type {
  NodeMouseHandler,
  Viewport,
} from 'reactflow'
import type { CursorPosition, OnlineUser } from './collaboration/types'
import type { Shape as HooksStoreShape } from './hooks-store'
import type { WorkflowSliceShape } from './store/workflow/workflow-slice'
import type {
  ConversationVariable,
  Edge,
  EnvironmentVariable,
  Node,
} from './types'
import type { VarInInspect } from '@/types/workflow'
import {
  useEventListener,
} from 'ahooks'
import { isEqual } from 'es-toolkit/predicate'
import { setAutoFreeze } from 'immer'
import dynamic from 'next/dynamic'
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodes,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import Toast from '@/app/components/base/toast'
import { IS_DEV } from '@/config'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { fetchAllInspectVars } from '@/service/workflow'
import { cn } from '@/utils/classnames'
import CandidateNode from './candidate-node'
import { collaborationManager } from './collaboration'
import UserCursors from './collaboration/components/user-cursors'
import { CommentCursor, CommentIcon, CommentInput, CommentThread } from './comment'
import CommentManager from './comment-manager'
import {
  CUSTOM_EDGE,
  CUSTOM_NODE,
  ITERATION_CHILDREN_Z_INDEX,
  WORKFLOW_DATA_UPDATE,
} from './constants'
import CustomConnectionLine from './custom-connection-line'
import CustomEdge from './custom-edge'
import {
  CUSTOM_GROUP_EXIT_PORT_NODE,
  CUSTOM_GROUP_INPUT_NODE,
  CUSTOM_GROUP_NODE,
  CustomGroupExitPortNode,
  CustomGroupInputNode,
  CustomGroupNode,
} from './custom-group-node'
import DatasetsDetailProvider from './datasets-detail-store/provider'
import HelpLine from './help-line'
import {
  useEdgesInteractions,
  useLeaderRestoreListener,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
  usePanelInteractions,
  useSelectionInteractions,
  useSetWorkflowVarsWithValue,
  useShortcuts,
  useWorkflow,
  useWorkflowReadOnly,
  useWorkflowRefreshDraft,
} from './hooks'
import { HooksStoreContextProvider, useHooksStore } from './hooks-store'
import { useWorkflowComment } from './hooks/use-workflow-comment'
import { useWorkflowSearch } from './hooks/use-workflow-search'
import NodeContextmenu from './node-contextmenu'
import CustomNode from './nodes'
import useMatchSchemaType from './nodes/_base/components/variable/use-match-schema-type'
import CustomDataSourceEmptyNode from './nodes/data-source-empty'
import { CUSTOM_DATA_SOURCE_EMPTY_NODE } from './nodes/data-source-empty/constants'
import CustomIterationStartNode from './nodes/iteration-start'
import { CUSTOM_ITERATION_START_NODE } from './nodes/iteration-start/constants'
import CustomLoopStartNode from './nodes/loop-start'
import { CUSTOM_LOOP_START_NODE } from './nodes/loop-start/constants'
import CustomSubGraphStartNode from './nodes/sub-graph-start'
import { CUSTOM_SUB_GRAPH_START_NODE } from './nodes/sub-graph-start/constants'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import Operator from './operator'
import Control from './operator/control'
import PanelContextmenu from './panel-contextmenu'
import SelectionContextmenu from './selection-contextmenu'
import CustomSimpleNode from './simple-node'
import { CUSTOM_SIMPLE_NODE } from './simple-node/constants'
import {
  useStore,
  useWorkflowStore,
} from './store'
import SyncingDataModal from './syncing-data-modal'
import {
  BlockEnum,
  ControlMode,
  WorkflowRunningStatus,
} from './types'
import { setupScrollToNodeListener } from './utils/node-navigation'
import { WorkflowHistoryProvider } from './workflow-history-store'
import 'reactflow/dist/style.css'
import './style.css'

const Confirm = dynamic(() => import('@/app/components/base/confirm'), {
  ssr: false,
})

const nodeTypes = {
  [CUSTOM_NODE]: CustomNode,
  [CUSTOM_NOTE_NODE]: CustomNoteNode,
  [CUSTOM_SIMPLE_NODE]: CustomSimpleNode,
  [CUSTOM_SUB_GRAPH_START_NODE]: CustomSubGraphStartNode,
  [CUSTOM_ITERATION_START_NODE]: CustomIterationStartNode,
  [CUSTOM_LOOP_START_NODE]: CustomLoopStartNode,
  [CUSTOM_DATA_SOURCE_EMPTY_NODE]: CustomDataSourceEmptyNode,
  [CUSTOM_GROUP_NODE]: CustomGroupNode,
  [CUSTOM_GROUP_INPUT_NODE]: CustomGroupInputNode,
  [CUSTOM_GROUP_EXIT_PORT_NODE]: CustomGroupExitPortNode,
}
const edgeTypes = {
  [CUSTOM_EDGE]: CustomEdge,
}

export enum InteractionMode {
  Default = 'default',
  Subgraph = 'subgraph',
}

type WorkflowDataUpdatePayload = {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  hash?: string
  features?: unknown
  conversation_variables?: ConversationVariable[]
  environment_variables?: EnvironmentVariable[]
}

export type WorkflowProps = {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  children?: React.ReactNode
  onWorkflowDataUpdate?: (v: WorkflowDataUpdatePayload) => void
  allowSelectionWhenReadOnly?: boolean
  canvasReadOnly?: boolean
  interactionMode?: InteractionMode
  cursors?: Record<string, CursorPosition>
  myUserId?: string | null
  onlineUsers?: OnlineUser[]
}

const CommentPlacementPreview = memo(({
  onSubmit,
  onCancel,
}: {
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  onCancel: () => void
}) => {
  const isCommentPlacing = useStore(s => s.isCommentPlacing)
  const pendingComment = useStore(s => s.pendingComment)
  const mousePosition = useStore(s => s.mousePosition)

  if (!isCommentPlacing || pendingComment)
    return null

  return (
    <CommentInput
      position={{
        x: mousePosition.elementX,
        y: mousePosition.elementY,
      }}
      onSubmit={onSubmit}
      onCancel={onCancel}
      autoFocus={false}
      disabled
    />
  )
})

CommentPlacementPreview.displayName = 'CommentPlacementPreview'

export const Workflow: FC<WorkflowProps> = memo(({
  nodes: originalNodes,
  edges: originalEdges,
  viewport,
  children,
  onWorkflowDataUpdate,
  allowSelectionWhenReadOnly = false,
  canvasReadOnly = false,
  interactionMode = 'default',
  cursors,
  myUserId,
  onlineUsers,
}) => {
  const workflowContainerRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const store = useStoreApi()
  const [isMouseOverCanvas, setIsMouseOverCanvas] = useState(false)
  const [nodes, setNodes] = useNodesState(originalNodes)
  const [edges, setEdges] = useEdgesState(originalEdges)
  const controlMode = useStore(s => s.controlMode)
  const nodeAnimation = useStore(s => s.nodeAnimation)
  const showConfirm = useStore(s => s.showConfirm)
  const workflowCanvasHeight = useStore(s => s.workflowCanvasHeight)
  const bottomPanelHeight = useStore(s => s.bottomPanelHeight)
  const setWorkflowCanvasWidth = useStore(s => s.setWorkflowCanvasWidth)
  const setWorkflowCanvasHeight = useStore(s => s.setWorkflowCanvasHeight)
  const controlHeight = useMemo(() => {
    if (!workflowCanvasHeight)
      return '100%'
    return workflowCanvasHeight - bottomPanelHeight
  }, [workflowCanvasHeight, bottomPanelHeight])

  // update workflow Canvas width and height
  useEffect(() => {
    if (workflowContainerRef.current) {
      const resizeContainerObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize, blockSize } = entry.borderBoxSize[0]
          setWorkflowCanvasWidth(inlineSize)
          setWorkflowCanvasHeight(blockSize)
        }
      })
      resizeContainerObserver.observe(workflowContainerRef.current)
      return () => {
        resizeContainerObserver.disconnect()
      }
    }
  }, [setWorkflowCanvasHeight, setWorkflowCanvasWidth])

  const {
    setShowConfirm,
    setControlPromptEditorRerenderKey,
    setSyncWorkflowDraftHash,
    setNodes: setNodesInStore,
  } = workflowStore.getState()
  const currentNodes = useNodes()
  const setNodesOnlyChangeWithData = useCallback((nodes: Node[]) => {
    const nodesData = nodes.map(node => ({
      id: node.id,
      data: node.data,
    }))
    const oldData = workflowStore.getState().nodes.map(node => ({
      id: node.id,
      data: node.data,
    }))
    if (!isEqual(oldData, nodesData)) {
      setNodesInStore(nodes)
    }
  }, [setNodesInStore])
  useEffect(() => {
    setNodesOnlyChangeWithData(currentNodes as Node[])
  }, [currentNodes, setNodesOnlyChangeWithData])
  useEffect(() => {
    return collaborationManager.onGraphImport(({ nodes: importedNodes, edges: importedEdges }) => {
      if (!isEqual(nodes, importedNodes)) {
        setNodes(importedNodes)
        store.getState().setNodes(importedNodes)
      }
      if (!isEqual(edges, importedEdges)) {
        setEdges(importedEdges)
        store.getState().setEdges(importedEdges)
      }
    })
  }, [edges, nodes, setEdges, setNodes, store])

  useEffect(() => {
    return collaborationManager.onHistoryAction((_) => {
      Toast.notify({
        type: 'info',
        message: t('collaboration.historyAction.generic', { ns: 'workflow' }),
      })
    })
  }, [t])
  const {
    handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft()
  const { workflowReadOnly } = useWorkflowReadOnly()
  const { nodesReadOnly } = useNodesReadOnly()
  const { eventEmitter } = useEventEmitterContextContext()
  const {
    comments,
    pendingComment,
    activeComment,
    activeCommentLoading,
    replySubmitting,
    replyUpdating,
    handleCommentSubmit,
    handleCommentCancel,
    handleCommentIconClick,
    handleActiveCommentClose,
    handleCommentResolve,
    handleCommentDelete,
    handleCommentReply,
    handleCommentReplyUpdate,
    handleCommentReplyDelete,
    handleCommentPositionUpdate,
  } = useWorkflowComment()
  const showUserComments = useStore(s => s.showUserComments)
  const showUserCursors = useStore(s => s.showUserCursors)
  const showResolvedComments = useStore(s => s.showResolvedComments)
  const isCommentPreviewHovering = useStore(s => s.isCommentPreviewHovering)
  const isCommentPlacing = useStore(s => s.isCommentPlacing)
  const setCommentPlacing = useStore(s => s.setCommentPlacing)
  const setCommentQuickAdd = useStore(s => s.setCommentQuickAdd)
  const setPendingCommentState = useStore(s => s.setPendingComment)
  const isCommentInputActive = Boolean(pendingComment) || isCommentPlacing
  const visibleComments = useMemo(() => {
    if (showResolvedComments)
      return comments
    return comments.filter(comment => !comment.resolved)
  }, [comments, showResolvedComments])
  const handleVisibleCommentNavigate = useCallback((direction: 'prev' | 'next') => {
    if (!activeComment)
      return
    const idx = visibleComments.findIndex(comment => comment.id === activeComment.id)
    if (idx === -1)
      return
    const target = direction === 'prev' ? visibleComments[idx - 1] : visibleComments[idx + 1]
    if (target)
      handleCommentIconClick(target)
  }, [activeComment, handleCommentIconClick, visibleComments])

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === WORKFLOW_DATA_UPDATE) {
      if (interactionMode === InteractionMode.Subgraph)
        return
      setNodes(v.payload.nodes)
      store.getState().setNodes(v.payload.nodes)
      setEdges(v.payload.edges)

      if (v.payload.viewport)
        reactflow.setViewport(v.payload.viewport)

      if (v.payload.hash)
        setSyncWorkflowDraftHash(v.payload.hash)

      onWorkflowDataUpdate?.(v.payload)

      setTimeout(() => setControlPromptEditorRerenderKey(Date.now()))
    }
  })

  useEffect(() => {
    setAutoFreeze(false)

    return () => {
      setAutoFreeze(true)
    }
  }, [])

  useEffect(() => {
    return () => {
      handleSyncWorkflowDraft(true, true)
    }
  }, [handleSyncWorkflowDraft])

  const handlePendingCommentPositionChange = useCallback((position: NonNullable<WorkflowSliceShape['pendingComment']>) => {
    setPendingCommentState(position)
  }, [setPendingCommentState])

  const handleCommentPlacementCancel = useCallback(() => {
    setPendingCommentState(null)
    setCommentPlacing(false)
    setCommentQuickAdd(false)
  }, [setCommentPlacing, setCommentQuickAdd, setPendingCommentState])

  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const handleSyncWorkflowDraftWhenPageClose = useCallback(() => {
    if (document.visibilityState === 'hidden') {
      syncWorkflowDraftWhenPageClose()
      return
    }

    if (document.visibilityState === 'visible') {
      const { isListening, workflowRunningData } = workflowStore.getState()
      const status = workflowRunningData?.result?.status
      // Avoid resetting UI state when user comes back while a run is active or listening for triggers
      if (isListening || status === WorkflowRunningStatus.Running)
        return

      setTimeout(() => handleRefreshWorkflowDraft(), 500)
    }
  }, [syncWorkflowDraftWhenPageClose, handleRefreshWorkflowDraft, workflowStore])

  // Also add beforeunload handler as additional safety net for tab close
  const handleBeforeUnload = useCallback(() => {
    syncWorkflowDraftWhenPageClose()
  }, [syncWorkflowDraftWhenPageClose])

  // Optimized comment deletion using showConfirm
  const handleCommentDeleteClick = useCallback((commentId: string) => {
    if (!showConfirm) {
      setShowConfirm({
        title: t('comments.confirm.deleteThreadTitle', { ns: 'workflow' }),
        desc: t('comments.confirm.deleteThreadDesc', { ns: 'workflow' }),
        onConfirm: async () => {
          await handleCommentDelete(commentId)
          setShowConfirm(undefined)
        },
      })
    }
  }, [showConfirm, setShowConfirm, handleCommentDelete, t])

  const handleCommentReplyDeleteClick = useCallback((commentId: string, replyId: string) => {
    if (!showConfirm) {
      setShowConfirm({
        title: t('comments.confirm.deleteReplyTitle', { ns: 'workflow' }),
        desc: t('comments.confirm.deleteReplyDesc', { ns: 'workflow' }),
        onConfirm: async () => {
          await handleCommentReplyDelete(commentId, replyId)
          setShowConfirm(undefined)
        },
      })
    }
  }, [showConfirm, setShowConfirm, handleCommentReplyDelete, t])

  useEffect(() => {
    document.addEventListener('visibilitychange', handleSyncWorkflowDraftWhenPageClose)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', handleSyncWorkflowDraftWhenPageClose)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [handleSyncWorkflowDraftWhenPageClose, handleBeforeUnload])

  useEventListener('keydown', (e) => {
    if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey))
      e.preventDefault()
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey))
      e.preventDefault()
    if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey))
      e.preventDefault()
    if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey))
      e.preventDefault()
  })
  useEventListener('mousemove', (e) => {
    const containerClientRect = workflowContainerRef.current?.getBoundingClientRect()

    if (containerClientRect) {
      workflowStore.setState({
        mousePosition: {
          pageX: e.clientX,
          pageY: e.clientY,
          elementX: e.clientX - containerClientRect.left,
          elementY: e.clientY - containerClientRect.top,
        },
      })
      const target = e.target as HTMLElement
      const onPane = !!target?.closest('.react-flow__pane')
      setIsMouseOverCanvas(onPane)
    }
  })

  // Prevent browser zoom interactions from hijacking gestures meant for the workflow canvas
  useEffect(() => {
    const preventBrowserZoom = (event: WheelEvent) => {
      if (!isCommentPreviewHovering && !isCommentInputActive)
        return

      if (event.ctrlKey || event.metaKey)
        event.preventDefault()
    }

    const preventGestureZoom = (event: Event) => {
      if (!isCommentPreviewHovering && !isCommentInputActive)
        return

      event.preventDefault()
    }

    window.addEventListener('wheel', preventBrowserZoom, { passive: false })
    const gestureEvents: Array<'gesturestart' | 'gesturechange' | 'gestureend'> = ['gesturestart', 'gesturechange', 'gestureend']
    gestureEvents.forEach((eventName) => {
      window.addEventListener(eventName, preventGestureZoom, { passive: false })
    })

    return () => {
      window.removeEventListener('wheel', preventBrowserZoom)
      gestureEvents.forEach((eventName) => {
        window.removeEventListener(eventName, preventGestureZoom)
      })
    }
  }, [isCommentPreviewHovering, isCommentInputActive])

  const {
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleNodeEnter,
    handleNodeLeave,
    handleNodeClick,
    handleNodeConnect,
    handleNodeConnectStart,
    handleNodeConnectEnd,
    handleNodeContextMenu,
    handleHistoryBack,
    handleHistoryForward,
  } = useNodesInteractions()
  const {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgesChange,
  } = useEdgesInteractions()
  const {
    handleSelectionStart,
    handleSelectionChange,
    handleSelectionDrag,
    handleSelectionContextMenu,
  } = useSelectionInteractions()
  const {
    handlePaneContextMenu,
  } = usePanelInteractions()
  const {
    isValidConnection,
  } = useWorkflow()

  useOnViewportChange({
    onEnd: () => {
      handleSyncWorkflowDraft()
    },
  })

  const isSubGraph = interactionMode === 'subgraph'
  useShortcuts(!isSubGraph)
  // Initialize workflow node search functionality
  useWorkflowSearch()

  useLeaderRestoreListener()

  // Set up scroll to node event listener using the utility function
  useEffect(() => {
    return setupScrollToNodeListener(nodes, reactflow)
  }, [nodes, reactflow])

  const { schemaTypeDefinitions } = useMatchSchemaType()
  const { fetchInspectVars } = useSetWorkflowVarsWithValue()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  // buildInTools, customTools, workflowTools, mcpTools, dataSourceList
  const configsMap = useHooksStore(s => s.configsMap)
  const subGraphSelectableNodeTypes = useHooksStore(s => s.subGraphSelectableNodeTypes)
  const [isLoadedVars, setIsLoadedVars] = useState(false)
  const [vars, setVars] = useState<VarInInspect[]>([])
  useEffect(() => {
    (async () => {
      if (!configsMap?.flowType || !configsMap?.flowId)
        return
      const data = await fetchAllInspectVars(configsMap.flowType, configsMap.flowId)
      setVars(data)
      setIsLoadedVars(true)
    })()
  }, [configsMap?.flowType, configsMap?.flowId])
  useEffect(() => {
    if (schemaTypeDefinitions && isLoadedVars) {
      fetchInspectVars({
        passInVars: true,
        vars,
        passedInAllPluginInfoList: {
          buildInTools: buildInTools || [],
          customTools: customTools || [],
          workflowTools: workflowTools || [],
          mcpTools: mcpTools || [],
          dataSourceList: dataSourceList ?? [],
        },
        passedInSchemaTypeDefinitions: schemaTypeDefinitions,
      })
    }
  }, [schemaTypeDefinitions, fetchInspectVars, isLoadedVars, vars, customTools, buildInTools, workflowTools, mcpTools, dataSourceList])

  if (IS_DEV) {
    store.getState().onError = (code, message) => {
      if (code === '002')
        return
      console.warn(message)
    }
  }

  const handleNodeClickInMode = useCallback<NodeMouseHandler>(
    (event, node) => {
      if (isSubGraph) {
        const allowTypes = subGraphSelectableNodeTypes?.length
          ? subGraphSelectableNodeTypes
          : [BlockEnum.LLM]
        if (!allowTypes.includes(node.data.type))
          return
      }

      handleNodeClick(event, node)
    },
    [handleNodeClick, isSubGraph, subGraphSelectableNodeTypes],
  )

  return (
    <div
      id="workflow-container"
      className={cn(
        'relative h-full w-full min-w-[960px] overflow-hidden',
        workflowReadOnly && 'workflow-panel-animation',
        nodeAnimation && 'workflow-node-animation',
      )}
      ref={workflowContainerRef}
    >
      <SyncingDataModal />
      {!isSubGraph && <CandidateNode />}
      <CommentManager />
      <div
        className="pointer-events-none absolute left-0 top-0 z-[60] flex w-12 items-center justify-center p-1 pl-2"
        style={{ height: controlHeight }}
      >
        {!isSubGraph && <Control />}
      </div>
      <Operator handleRedo={handleHistoryForward} handleUndo={handleHistoryBack} />
      {!isSubGraph && <PanelContextmenu />}
      {!isSubGraph && <NodeContextmenu />}
      {!isSubGraph && <SelectionContextmenu />}
      {!isSubGraph && <HelpLine />}
      {!!showConfirm && (
        <Confirm
          isShow
          onCancel={() => setShowConfirm(undefined)}
          onConfirm={showConfirm.onConfirm}
          title={showConfirm.title}
          content={showConfirm.desc}
        />
      )}
      {controlMode === ControlMode.Comment && isMouseOverCanvas && (
        <CommentCursor />
      )}
      <CommentPlacementPreview
        onSubmit={handleCommentSubmit}
        onCancel={handleCommentPlacementCancel}
      />
      {pendingComment && (
        <CommentInput
          position={{
            x: pendingComment.elementX,
            y: pendingComment.elementY,
          }}
          onSubmit={handleCommentSubmit}
          onCancel={handleCommentCancel}
          onPositionChange={handlePendingCommentPositionChange}
        />
      )}
      {visibleComments.map((comment, index) => {
        const isActive = activeComment?.id === comment.id

        if (isActive && activeComment) {
          const canGoPrev = index > 0
          const canGoNext = index < visibleComments.length - 1
          return (
            <Fragment key={comment.id}>
              <CommentIcon
                key={`${comment.id}-icon`}
                comment={comment}
                onClick={() => handleCommentIconClick(comment)}
                isActive={true}
                onPositionUpdate={position => handleCommentPositionUpdate(comment.id, position)}
              />
              <CommentThread
                key={`${comment.id}-thread`}
                comment={activeComment}
                loading={activeCommentLoading}
                replySubmitting={replySubmitting}
                replyUpdating={replyUpdating}
                onClose={handleActiveCommentClose}
                onResolve={() => handleCommentResolve(comment.id)}
                onDelete={() => handleCommentDeleteClick(comment.id)}
                onPrev={canGoPrev ? () => handleVisibleCommentNavigate('prev') : undefined}
                onNext={canGoNext ? () => handleVisibleCommentNavigate('next') : undefined}
                onReply={(content, ids) => handleCommentReply(comment.id, content, ids ?? [])}
                onReplyEdit={(replyId, content, ids) => handleCommentReplyUpdate(comment.id, replyId, content, ids ?? [])}
                onReplyDelete={replyId => handleCommentReplyDeleteClick(comment.id, replyId)}
                onReplyDeleteDirect={replyId => handleCommentReplyDelete(comment.id, replyId)}
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
              />
            </Fragment>
          )
        }

        return (showUserComments || controlMode === ControlMode.Comment)
          ? (
              <CommentIcon
                key={comment.id}
                comment={comment}
                onClick={() => handleCommentIconClick(comment)}
                onPositionUpdate={position => handleCommentPositionUpdate(comment.id, position)}
              />
            )
          : null
      })}
      {children}
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
        className={controlMode === ControlMode.Comment ? 'comment-mode-flow' : ''}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeMouseEnter={handleNodeEnter}
        onNodeMouseLeave={handleNodeLeave}
        onNodeClick={handleNodeClickInMode}
        onNodeContextMenu={isSubGraph ? undefined : handleNodeContextMenu}
        onConnect={isSubGraph ? undefined : handleNodeConnect}
        onConnectStart={isSubGraph ? undefined : handleNodeConnectStart}
        onConnectEnd={isSubGraph ? undefined : handleNodeConnectEnd}
        onEdgeMouseEnter={handleEdgeEnter}
        onEdgeMouseLeave={handleEdgeLeave}
        onEdgesChange={handleEdgesChange}
        onSelectionStart={isSubGraph ? undefined : handleSelectionStart}
        onSelectionChange={isSubGraph ? undefined : handleSelectionChange}
        onSelectionDrag={isSubGraph ? undefined : handleSelectionDrag}
        onPaneContextMenu={isSubGraph ? undefined : handlePaneContextMenu}
        onSelectionContextMenu={isSubGraph ? undefined : handleSelectionContextMenu}
        connectionLineComponent={CustomConnectionLine}
        // NOTE: For LOOP node, how to distinguish between ITERATION and LOOP here? Maybe both are the same?
        connectionLineContainerStyle={{ zIndex: ITERATION_CHILDREN_Z_INDEX }}
        defaultViewport={viewport}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        nodesDraggable={!(nodesReadOnly || canvasReadOnly || isSubGraph) && controlMode !== ControlMode.Comment}
        nodesConnectable={!(nodesReadOnly || canvasReadOnly || isSubGraph)}
        nodesFocusable={allowSelectionWhenReadOnly ? true : !nodesReadOnly}
        edgesFocusable={isSubGraph ? false : (allowSelectionWhenReadOnly ? true : !nodesReadOnly)}
        panOnScroll={!isSubGraph && controlMode === ControlMode.Pointer && !workflowReadOnly}
        panOnDrag={!isSubGraph && (controlMode === ControlMode.Hand || [1])}
        selectionOnDrag={!isSubGraph && controlMode === ControlMode.Pointer && !workflowReadOnly && !canvasReadOnly}
        zoomOnPinch={!isSubGraph}
        zoomOnScroll={!isSubGraph}
        zoomOnDoubleClick={!isSubGraph}
        isValidConnection={isValidConnection}
        selectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        minZoom={0.25}
      >
        <Background
          gap={[14, 14]}
          size={2}
          className="bg-workflow-canvas-workflow-bg"
          color="var(--color-workflow-canvas-workflow-dot-color)"
        />
        {showUserCursors && cursors && (
          <UserCursors
            cursors={cursors}
            myUserId={myUserId || null}
            onlineUsers={onlineUsers || []}
          />
        )}
      </ReactFlow>
    </div>
  )
})

type WorkflowWithInnerContextProps = WorkflowProps & {
  hooksStore?: Partial<HooksStoreShape>
  cursors?: Record<string, CursorPosition>
  myUserId?: string | null
  onlineUsers?: OnlineUser[]
}
export const WorkflowWithInnerContext = memo(({
  hooksStore,
  cursors,
  myUserId,
  onlineUsers,
  ...restProps
}: WorkflowWithInnerContextProps) => {
  return (
    <HooksStoreContextProvider {...hooksStore}>
      <Workflow
        {...restProps}
        cursors={cursors}
        myUserId={myUserId}
        onlineUsers={onlineUsers}
      />
    </HooksStoreContextProvider>
  )
})

type WorkflowWithDefaultContextProps
  = Pick<WorkflowProps, 'edges' | 'nodes'>
    & {
      children: React.ReactNode
    }

const WorkflowWithDefaultContext = ({
  nodes,
  edges,
  children,
}: WorkflowWithDefaultContextProps) => {
  return (
    <ReactFlowProvider>
      <WorkflowHistoryProvider
        nodes={nodes}
        edges={edges}
      >
        <DatasetsDetailProvider nodes={nodes}>
          {children}
        </DatasetsDetailProvider>
      </WorkflowHistoryProvider>
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWithDefaultContext)
