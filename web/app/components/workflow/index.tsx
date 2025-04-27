'use client'

import type { FC } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { setAutoFreeze } from 'immer'
import {
  useEventListener,
} from 'ahooks'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import type {
  Viewport,
} from 'reactflow'
import 'reactflow/dist/style.css'
import './style.css'
import type {
  Edge,
  Node,
} from './types'
import {
  ControlMode,
} from './types'
import {
  useEdgesInteractions,
  useFetchToolsData,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
  usePanelInteractions,
  useSelectionInteractions,
  useShortcuts,
  useWorkflow,
  useWorkflowReadOnly,
  useWorkflowUpdate,
} from './hooks'
import CustomNode from './nodes'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import CustomIterationStartNode from './nodes/iteration-start'
import { CUSTOM_ITERATION_START_NODE } from './nodes/iteration-start/constants'
import CustomLoopStartNode from './nodes/loop-start'
import { CUSTOM_LOOP_START_NODE } from './nodes/loop-start/constants'
import CustomSimpleNode from './simple-node'
import { CUSTOM_SIMPLE_NODE } from './simple-node/constants'
import Operator from './operator'
import CustomEdge from './custom-edge'
import CustomConnectionLine from './custom-connection-line'
import HelpLine from './help-line'
import CandidateNode from './candidate-node'
import PanelContextmenu from './panel-contextmenu'
import NodeContextmenu from './node-contextmenu'
import SyncingDataModal from './syncing-data-modal'
import LimitTips from './limit-tips'
import {
  useStore,
  useWorkflowStore,
} from './store'
import {
  CUSTOM_EDGE,
  CUSTOM_NODE,
  ITERATION_CHILDREN_Z_INDEX,
  WORKFLOW_DATA_UPDATE,
} from './constants'
import { WorkflowHistoryProvider } from './workflow-history-store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Confirm from '@/app/components/base/confirm'
import DatasetsDetailProvider from './datasets-detail-store/provider'
import { HooksStoreContextProvider } from './hooks-store'
import type { Shape as HooksStoreShape } from './hooks-store'

const nodeTypes = {
  [CUSTOM_NODE]: CustomNode,
  [CUSTOM_NOTE_NODE]: CustomNoteNode,
  [CUSTOM_SIMPLE_NODE]: CustomSimpleNode,
  [CUSTOM_ITERATION_START_NODE]: CustomIterationStartNode,
  [CUSTOM_LOOP_START_NODE]: CustomLoopStartNode,
}
const edgeTypes = {
  [CUSTOM_EDGE]: CustomEdge,
}

export type WorkflowProps = {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  children?: React.ReactNode
  onWorkflowDataUpdate?: (v: any) => void
}
export const Workflow: FC<WorkflowProps> = memo(({
  nodes: originalNodes,
  edges: originalEdges,
  viewport,
  children,
  onWorkflowDataUpdate,
}) => {
  const workflowContainerRef = useRef<HTMLDivElement>(null)
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const [nodes, setNodes] = useNodesState(originalNodes)
  const [edges, setEdges] = useEdgesState(originalEdges)
  const controlMode = useStore(s => s.controlMode)
  const nodeAnimation = useStore(s => s.nodeAnimation)
  const showConfirm = useStore(s => s.showConfirm)

  const {
    setShowConfirm,
    setControlPromptEditorRerenderKey,
    setSyncWorkflowDraftHash,
  } = workflowStore.getState()
  const {
    handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft()
  const { workflowReadOnly } = useWorkflowReadOnly()
  const { nodesReadOnly } = useNodesReadOnly()
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === WORKFLOW_DATA_UPDATE) {
      setNodes(v.payload.nodes)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { handleRefreshWorkflowDraft } = useWorkflowUpdate()
  const handleSyncWorkflowDraftWhenPageClose = useCallback(() => {
    if (document.visibilityState === 'hidden')
      syncWorkflowDraftWhenPageClose()
    else if (document.visibilityState === 'visible')
      setTimeout(() => handleRefreshWorkflowDraft(), 500)
  }, [syncWorkflowDraftWhenPageClose, handleRefreshWorkflowDraft])

  useEffect(() => {
    document.addEventListener('visibilitychange', handleSyncWorkflowDraftWhenPageClose)

    return () => {
      document.removeEventListener('visibilitychange', handleSyncWorkflowDraftWhenPageClose)
    }
  }, [handleSyncWorkflowDraftWhenPageClose])

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
    }
  })
  const { handleFetchAllTools } = useFetchToolsData()
  useEffect(() => {
    handleFetchAllTools('builtin')
    handleFetchAllTools('custom')
    handleFetchAllTools('workflow')
  }, [handleFetchAllTools])

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

  useShortcuts()

  const store = useStoreApi()
  if (process.env.NODE_ENV === 'development') {
    store.getState().onError = (code, message) => {
      if (code === '002')
        return
      console.warn(message)
    }
  }

  return (
    <div
      id='workflow-container'
      className={`
        relative h-full w-full min-w-[960px] 
        ${workflowReadOnly && 'workflow-panel-animation'}
        ${nodeAnimation && 'workflow-node-animation'}
      `}
      ref={workflowContainerRef}
    >
      <SyncingDataModal />
      <CandidateNode />
      <Operator handleRedo={handleHistoryForward} handleUndo={handleHistoryBack} />
      <PanelContextmenu />
      <NodeContextmenu />
      <HelpLine />
      {
        !!showConfirm && (
          <Confirm
            isShow
            onCancel={() => setShowConfirm(undefined)}
            onConfirm={showConfirm.onConfirm}
            title={showConfirm.title}
            content={showConfirm.desc}
          />
        )
      }
      <LimitTips />
      {children}
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeMouseEnter={handleNodeEnter}
        onNodeMouseLeave={handleNodeLeave}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onConnect={handleNodeConnect}
        onConnectStart={handleNodeConnectStart}
        onConnectEnd={handleNodeConnectEnd}
        onEdgeMouseEnter={handleEdgeEnter}
        onEdgeMouseLeave={handleEdgeLeave}
        onEdgesChange={handleEdgesChange}
        onSelectionStart={handleSelectionStart}
        onSelectionChange={handleSelectionChange}
        onSelectionDrag={handleSelectionDrag}
        onPaneContextMenu={handlePaneContextMenu}
        connectionLineComponent={CustomConnectionLine}
        // TODO: For LOOP node, how to distinguish between ITERATION and LOOP here? Maybe both are the same?
        connectionLineContainerStyle={{ zIndex: ITERATION_CHILDREN_Z_INDEX }}
        defaultViewport={viewport}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        nodesDraggable={!nodesReadOnly}
        nodesConnectable={!nodesReadOnly}
        nodesFocusable={!nodesReadOnly}
        edgesFocusable={!nodesReadOnly}
        panOnScroll
        panOnDrag={controlMode === ControlMode.Hand && !workflowReadOnly}
        zoomOnPinch={!workflowReadOnly}
        zoomOnScroll={!workflowReadOnly}
        zoomOnDoubleClick={!workflowReadOnly}
        isValidConnection={isValidConnection}
        selectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={controlMode === ControlMode.Pointer && !workflowReadOnly}
        minZoom={0.25}
      >
        <Background
          gap={[14, 14]}
          size={2}
          className="bg-workflow-canvas-workflow-bg"
          color='var(--color-workflow-canvas-workflow-dot-color)'
        />
      </ReactFlow>
    </div>
  )
})

type WorkflowWithInnerContextProps = WorkflowProps & {
  hooksStore?: Partial<HooksStoreShape>
}
export const WorkflowWithInnerContext = memo(({
  hooksStore,
  ...restProps
}: WorkflowWithInnerContextProps) => {
  return (
    <HooksStoreContextProvider {...hooksStore}>
      <Workflow {...restProps} />
    </HooksStoreContextProvider>
  )
})

type WorkflowWithDefaultContextProps =
  Pick<WorkflowProps, 'edges' | 'nodes'>
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
        edges={edges} >
        <DatasetsDetailProvider nodes={nodes}>
          {children}
        </DatasetsDetailProvider>
      </WorkflowHistoryProvider>
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWithDefaultContext)
