'use client'

import type { FC } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import useSWR from 'swr'
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
  EnvironmentVariable,
  Node,
} from './types'
import {
  ControlMode,
  SupportUploadFileTypes,
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
  useShortcuts,
  useWorkflow,
  useWorkflowInit,
  useWorkflowReadOnly,
  useWorkflowUpdate,
} from './hooks'
import Header from './header'
import CustomNode from './nodes'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import CustomIterationStartNode from './nodes/iteration-start'
import { CUSTOM_ITERATION_START_NODE } from './nodes/iteration-start/constants'
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
import DSLExportConfirmModal from './dsl-export-confirm-modal'
import LimitTips from './limit-tips'
import {
  useStore,
  useWorkflowStore,
} from './store'
import {
  initialEdges,
  initialNodes,
} from './utils'
import {
  CUSTOM_NODE,
  DSL_EXPORT_CHECK,
  ITERATION_CHILDREN_Z_INDEX,
  WORKFLOW_DATA_UPDATE,
} from './constants'
import { WorkflowHistoryProvider } from './workflow-history-store'
import Loading from '@/app/components/base/loading'
import { FeaturesProvider } from '@/app/components/base/features'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Confirm from '@/app/components/base/confirm'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { fetchFileUploadConfig } from '@/service/common'

const nodeTypes = {
  [CUSTOM_NODE]: CustomNode,
  [CUSTOM_NOTE_NODE]: CustomNoteNode,
  [CUSTOM_ITERATION_START_NODE]: CustomIterationStartNode,
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

  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])

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
    if (v.type === DSL_EXPORT_CHECK)
      setSecretEnvList(v.payload.data as EnvironmentVariable[])
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
    handlePaneContextmenuCancel,
  } = usePanelInteractions()
  const {
    isValidConnection,
  } = useWorkflow()
  const {
    exportCheck,
    handleExportDSL,
  } = useDSL()

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
        relative w-full min-w-[960px] h-full 
        ${workflowReadOnly && 'workflow-panel-animation'}
        ${nodeAnimation && 'workflow-node-animation'}
      `}
      ref={workflowContainerRef}
    >
      <SyncingDataModal />
      <CandidateNode />
      <Header />
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
            content={showConfirm.desc}
          />
        )
      }
      {
        showImportDSLModal && (
          <UpdateDSLModal
            onCancel={() => setShowImportDSLModal(false)}
            onBackup={exportCheck}
            onImport={handlePaneContextmenuCancel}
          />
        )
      }
      {
        secretEnvList.length > 0 && (
          <DSLExportConfirmModal
            envList={secretEnvList}
            onConfirm={handleExportDSL}
            onClose={() => setSecretEnvList([])}
          />
        )
      }
      <LimitTips />
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
Workflow.displayName = 'Workflow'

const WorkflowWrap = memo(() => {
  const {
    data,
    isLoading,
  } = useWorkflowInit()
  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)

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
      <div className='flex justify-center items-center relative w-full h-full'>
        <Loading />
      </div>
    )
  }

  const features = data.features || {}
  const initialFeatures: FeaturesData = {
    file: {
      image: {
        enabled: !!features.file_upload?.image?.enabled,
        number_limits: features.file_upload?.image?.number_limits || 3,
        transfer_methods: features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      },
      enabled: !!(features.file_upload?.enabled || features.file_upload?.image?.enabled),
      allowed_file_types: features.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: features.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
      allowed_file_upload_methods: features.file_upload?.allowed_file_upload_methods || features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      number_limits: features.file_upload?.number_limits || features.file_upload?.image?.number_limits || 3,
      fileUploadConfig: fileUploadConfigResponse,
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
