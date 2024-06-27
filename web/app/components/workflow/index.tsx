'use client'

import type { FC } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { setAutoFreeze } from 'immer'
import {
  useEventListener,
  useKeyPress,
} from 'ahooks'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
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
import { WorkflowContextProvider } from './context'
import {
  useDSL,
  useEdgesInteractions,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
  usePanelInteractions,
  useSelectionInteractions,
  useWorkflow,
  useWorkflowInit,
  useWorkflowReadOnly,
  useWorkflowStartRun,
  useWorkflowUpdate,
} from './hooks'
import Header from './header'
import CustomNode from './nodes'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import Operator from './operator'
import CustomEdge from './custom-edge'
import CustomConnectionLine from './custom-connection-line'
import Panel from './panel'
import Features from './features'
import HelpLine from './help-line'
import CandidateNode from './candidate-node'
import PanelContextmenu from './panel-contextmenu'
import NodeContextmenu from './node-contextmenu'
import SyncingDataModal from './syncing-data-modal'
import UpdateDSLModal from './update-dsl-modal'
import {
  useStore,
  useWorkflowStore,
} from './store'
import {
  getKeyboardKeyCodeBySystem,
  initialEdges,
  initialNodes,
  isEventTargetInputArea,
} from './utils'
import {
  CUSTOM_NODE,
  ITERATION_CHILDREN_Z_INDEX,
  WORKFLOW_DATA_UPDATE,
} from './constants'
import { WorkflowHistoryProvider, useWorkflowHistoryStore } from './workflow-history-store'
import Loading from '@/app/components/base/loading'
import { FeaturesProvider } from '@/app/components/base/features'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Confirm from '@/app/components/base/confirm/common'

const nodeTypes = {
  [CUSTOM_NODE]: CustomNode,
  [CUSTOM_NOTE_NODE]: CustomNoteNode,
}
const edgeTypes = {
  [CUSTOM_NODE]: CustomEdge,
}

type WorkflowProps = {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
}
const Workflow: FC<WorkflowProps> = memo(({
  nodes: originalNodes,
  edges: originalEdges,
  viewport,
}) => {
  const workflowContainerRef = useRef<HTMLDivElement>(null)
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const featuresStore = useFeaturesStore()
  const [nodes, setNodes] = useNodesState(originalNodes)
  const [edges, setEdges] = useEdgesState(originalEdges)
  const showFeaturesPanel = useStore(state => state.showFeaturesPanel)
  const controlMode = useStore(s => s.controlMode)
  const nodeAnimation = useStore(s => s.nodeAnimation)
  const showConfirm = useStore(s => s.showConfirm)
  const showImportDSLModal = useStore(s => s.showImportDSLModal)
  const {
    setShowConfirm,
    setControlPromptEditorRerenderKey,
    setShowImportDSLModal,
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

      if (v.payload.features && featuresStore) {
        const { setFeatures } = featuresStore.getState()

        setFeatures(v.payload.features)
      }

      if (v.payload.hash)
        setSyncWorkflowDraftHash(v.payload.hash)

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
    handleNodesCopy,
    handleNodesPaste,
    handleNodesDuplicate,
    handleNodesDelete,
    handleHistoryBack,
    handleHistoryForward,
  } = useNodesInteractions()
  const {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDelete,
    handleEdgesChange,
  } = useEdgesInteractions()
  const {
    handleSelectionStart,
    handleSelectionChange,
    handleSelectionDrag,
  } = useSelectionInteractions()
  const {
    handlePaneContextMenu,
    handlePaneContextmenuCancel,
  } = usePanelInteractions()
  const {
    isValidConnection,
  } = useWorkflow()
  const { handleStartWorkflowRun } = useWorkflowStartRun()
  const {
    handleExportDSL,
  } = useDSL()

  useOnViewportChange({
    onEnd: () => {
      handleSyncWorkflowDraft()
    },
  })

  const { shortcutsEnabled: workflowHistoryShortcutsEnabled } = useWorkflowHistoryStore()

  useKeyPress('delete', handleNodesDelete)
  useKeyPress(['delete', 'backspace'], handleEdgeDelete)
  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.c`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement))
      return

    handleNodesCopy()
  }, { exactMatch: true, useCapture: true })
  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.v`, (e) => {
    if (isEventTargetInputArea(e.target as HTMLElement))
      return

    handleNodesPaste()
  }, { exactMatch: true, useCapture: true })
  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.d`, handleNodesDuplicate, { exactMatch: true, useCapture: true })
  useKeyPress(`${getKeyboardKeyCodeBySystem('alt')}.r`, handleStartWorkflowRun, { exactMatch: true, useCapture: true })
  useKeyPress(`${getKeyboardKeyCodeBySystem('alt')}.r`, handleStartWorkflowRun, { exactMatch: true, useCapture: true })
  useKeyPress(
    `${getKeyboardKeyCodeBySystem('ctrl')}.z`,
    () => workflowHistoryShortcutsEnabled && handleHistoryBack(),
    { exactMatch: true, useCapture: true },
  )

  useKeyPress(
    [`${getKeyboardKeyCodeBySystem('ctrl')}.y`, `${getKeyboardKeyCodeBySystem('ctrl')}.shift.z`],
    () => workflowHistoryShortcutsEnabled && handleHistoryForward(),
    { exactMatch: true, useCapture: true },
  )

  return (
    <div
      id='workflow-container'
      className={`
        relative w-full min-w-[960px] h-full bg-[#F0F2F7]
        ${workflowReadOnly && 'workflow-panel-animation'}
        ${nodeAnimation && 'workflow-node-animation'}
      `}
      ref={workflowContainerRef}
    >
      <SyncingDataModal />
      <CandidateNode />
      <Header/>
      <Panel />
      <Operator handleRedo={handleHistoryForward} handleUndo={handleHistoryBack} />
      {
        showFeaturesPanel && <Features />
      }
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
            desc={showConfirm.desc}
            confirmWrapperClassName='!z-[11]'
          />
        )
      }
      {
        showImportDSLModal && (
          <UpdateDSLModal
            onCancel={() => setShowImportDSLModal(false)}
            onBackup={handleExportDSL}
            onImport={handlePaneContextmenuCancel}
          />
        )
      }
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
        connectionLineContainerStyle={{ zIndex: ITERATION_CHILDREN_Z_INDEX }}
        defaultViewport={viewport}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        nodesDraggable={!nodesReadOnly}
        nodesConnectable={!nodesReadOnly}
        nodesFocusable={!nodesReadOnly}
        edgesFocusable={!nodesReadOnly}
        panOnDrag={controlMode === 'hand' && !workflowReadOnly}
        zoomOnPinch={!workflowReadOnly}
        zoomOnScroll={!workflowReadOnly}
        zoomOnDoubleClick={!workflowReadOnly}
        isValidConnection={isValidConnection}
        selectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={controlMode === 'pointer' && !workflowReadOnly}
        minZoom={0.25}
      >
        <Background
          gap={[14, 14]}
          size={2}
          color='#E4E5E7'
        />
      </ReactFlow>
    </div>
  )
})
Workflow.displayName = 'Workflow'

const WorkflowWrap = memo(() => {
  const {
    data,
    isLoading,
  } = useWorkflowInit()

  const nodesData = useMemo(() => {
    if (data)
      return initialNodes(data.graph.nodes, data.graph.edges)

    return []
  }, [data])
  const edgesData = useMemo(() => {
    if (data)
      return initialEdges(data.graph.edges, data.graph.nodes)

    return []
  }, [data])

  if (!data || isLoading) {
    return (
      <div className='flex justify-center items-center relative w-full h-full bg-[#F0F2F7]'>
        <Loading />
      </div>
    )
  }

  const features = data.features || {}
  const initialFeatures: FeaturesData = {
    file: {
      image: {
        enabled: !!features.file_upload?.image.enabled,
        number_limits: features.file_upload?.image.number_limits || 3,
        transfer_methods: features.file_upload?.image.transfer_methods || ['local_file', 'remote_url'],
      },
    },
    opening: {
      enabled: !!features.opening_statement,
      opening_statement: features.opening_statement,
      suggested_questions: features.suggested_questions,
    },
    suggested: features.suggested_questions_after_answer || { enabled: false },
    speech2text: features.speech_to_text || { enabled: false },
    text2speech: features.text_to_speech || { enabled: false },
    citation: features.retriever_resource || { enabled: false },
    moderation: features.sensitive_word_avoidance || { enabled: false },
  }

  return (
    <ReactFlowProvider>
      <WorkflowHistoryProvider
        nodes={nodesData}
        edges={edgesData} >
        <FeaturesProvider features={initialFeatures}>
          <Workflow
            nodes={nodesData}
            edges={edgesData}
            viewport={data?.graph.viewport}
          />
        </FeaturesProvider>
      </WorkflowHistoryProvider>
    </ReactFlowProvider>
  )
})
WorkflowWrap.displayName = 'WorkflowWrap'

const WorkflowContainer = () => {
  return (
    <WorkflowContextProvider>
      <WorkflowWrap />
    </WorkflowContextProvider>
  )
}

export default memo(WorkflowContainer)
