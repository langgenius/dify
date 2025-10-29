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
import type { NodeDragHandler } from 'reactflow'
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
  useSetWorkflowVarsWithValue,
  useShortcuts,
  useWorkflow,
  useWorkflowReadOnly,
  useWorkflowRefreshDraft,
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
import CustomDataSourceEmptyNode from './nodes/data-source-empty'
import { CUSTOM_DATA_SOURCE_EMPTY_NODE } from './nodes/data-source-empty/constants'
import Operator from './operator'
import { useWorkflowSearch } from './hooks/use-workflow-search'
import Control from './operator/control'
import CustomEdge from './custom-edge'
import CustomConnectionLine from './custom-connection-line'
import HelpLine from './help-line'
import CandidateNode from './candidate-node'
import PanelContextmenu from './panel-contextmenu'
import NodeContextmenu from './node-contextmenu'
import SelectionContextmenu from './selection-contextmenu'
import SyncingDataModal from './syncing-data-modal'
import { setupScrollToNodeListener } from './utils/node-navigation'
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
import DatasetsDetailProvider from './datasets-detail-store/provider'
import { HooksStoreContextProvider, useHooksStore } from './hooks-store'
import type { Shape as HooksStoreShape } from './hooks-store'
import dynamic from 'next/dynamic'
import useMatchSchemaType from './nodes/_base/components/variable/use-match-schema-type'
import type { VarInInspect } from '@/types/workflow'
import { fetchAllInspectVars } from '@/service/workflow'
import cn from '@/utils/classnames'

const Confirm = dynamic(() => import('@/app/components/base/confirm'), {
  ssr: false,
})

const nodeTypes = {
  [CUSTOM_NODE]: CustomNode,
  [CUSTOM_NOTE_NODE]: CustomNoteNode,
  [CUSTOM_SIMPLE_NODE]: CustomSimpleNode,
  [CUSTOM_ITERATION_START_NODE]: CustomIterationStartNode,
  [CUSTOM_LOOP_START_NODE]: CustomLoopStartNode,
  [CUSTOM_DATA_SOURCE_EMPTY_NODE]: CustomDataSourceEmptyNode,
}
const edgeTypes = {
  [CUSTOM_EDGE]: CustomEdge,
}

const INITIAL_RENDER_NODE_LIMIT = 200
const VIEWPORT_NODE_BUFFER = 600

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
  const mousePositionRafRef = useRef<number | null>(null)
  const lastMouseEventRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const viewportUpdateRafRef = useRef<number | null>(null)
  const reactflow = useReactFlow()
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
  const [visibleNodeIds, setVisibleNodeIds] = useState<string[]>(() => {
    if (!originalNodes || !originalNodes.length)
      return []
    return originalNodes.slice(0, INITIAL_RENDER_NODE_LIMIT).map(node => node.id)
  })
  const visibleNodeIdSetRef = useRef<Set<string>>(new Set(visibleNodeIds))
  const isDraggingNodeRef = useRef(false)
  const [isDraggingNode, setIsDraggingNode] = useState(false)

  const ensureVisibleNodeIds = useCallback((candidateNodeIds: string[]) => {
    if (!candidateNodeIds || !candidateNodeIds.length)
      return

    const nextSet = new Set(visibleNodeIdSetRef.current)
    let changed = false

    candidateNodeIds.forEach((nodeId) => {
      if (!nextSet.has(nodeId)) {
        nextSet.add(nodeId)
        changed = true
      }
    })

    if (!changed)
      return

    visibleNodeIdSetRef.current = nextSet
    setVisibleNodeIds(Array.from(nextSet))
  }, [])

  const updateVisibleNodesByViewport = useCallback(() => {
    if (!workflowContainerRef.current || typeof reactflow.screenToFlowPosition !== 'function')
      return

    const rect = workflowContainerRef.current.getBoundingClientRect()
    const {
      width,
      height,
      left,
      top,
      right,
      bottom,
    } = rect
    if (!width || !height)
      return

    const topLeft = reactflow.screenToFlowPosition({ x: left, y: top })
    const bottomRight = reactflow.screenToFlowPosition({ x: right, y: bottom })

    const minX = Math.min(topLeft.x, bottomRight.x) - VIEWPORT_NODE_BUFFER
    const maxX = Math.max(topLeft.x, bottomRight.x) + VIEWPORT_NODE_BUFFER
    const minY = Math.min(topLeft.y, bottomRight.y) - VIEWPORT_NODE_BUFFER
    const maxY = Math.max(topLeft.y, bottomRight.y) + VIEWPORT_NODE_BUFFER

    const nodesInViewport = nodes
      .filter((node) => {
        const { position, positionAbsolute } = node
        const referencePosition = positionAbsolute ?? position
        if (!referencePosition)
          return false
        const { x, y } = referencePosition
        return x >= minX && x <= maxX && y >= minY && y <= maxY
      })
      .map(node => node.id)

    ensureVisibleNodeIds(nodesInViewport)
  }, [ensureVisibleNodeIds, nodes, reactflow])

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
    if (!originalNodes || !originalNodes.length)
      return
    const initialIds = originalNodes.slice(0, INITIAL_RENDER_NODE_LIMIT).map(node => node.id)
    visibleNodeIdSetRef.current = new Set(initialIds)
    setVisibleNodeIds(initialIds)
  }, [originalNodes])

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

  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
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
    lastMouseEventRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
    }

    if (mousePositionRafRef.current !== null)
      return

    mousePositionRafRef.current = requestAnimationFrame(() => {
      mousePositionRafRef.current = null
      const latestMousePosition = lastMouseEventRef.current
      const containerClientRect = workflowContainerRef.current?.getBoundingClientRect()

      if (!latestMousePosition || !containerClientRect)
        return

      workflowStore.setState({
        mousePosition: {
          pageX: latestMousePosition.clientX,
          pageY: latestMousePosition.clientY,
          elementX: latestMousePosition.clientX - containerClientRect.left,
          elementY: latestMousePosition.clientY - containerClientRect.top,
        },
      })
    })
  })
  useEffect(() => {
    return () => {
      if (viewportUpdateRafRef.current !== null)
        cancelAnimationFrame(viewportUpdateRafRef.current)
      if (mousePositionRafRef.current !== null)
        cancelAnimationFrame(mousePositionRafRef.current)
    }
  }, [])
  const { handleFetchAllTools } = useFetchToolsData()
  useEffect(() => {
    if (typeof window === 'undefined')
      return

    const fetchAllTools = () => {
      handleFetchAllTools('builtin')
      handleFetchAllTools('custom')
      handleFetchAllTools('workflow')
      handleFetchAllTools('mcp')
    }

    const timeoutId = window.setTimeout(fetchAllTools, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
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
    handleSelectionContextMenu,
  } = useSelectionInteractions()
  const {
    handlePaneContextMenu,
  } = usePanelInteractions()
  const {
    isValidConnection,
  } = useWorkflow()

  useOnViewportChange({
    onChange: () => {
      if (isDraggingNodeRef.current)
        return

      if (viewportUpdateRafRef.current !== null)
        return
      viewportUpdateRafRef.current = requestAnimationFrame(() => {
        viewportUpdateRafRef.current = null
        updateVisibleNodesByViewport()
      })
    },
    onEnd: () => {
      handleSyncWorkflowDraft()
      if (!isDraggingNodeRef.current)
        updateVisibleNodesByViewport()
    },
  })

  useShortcuts()
  // Initialize workflow node search functionality
  useWorkflowSearch()

  // Set up scroll to node event listener using the utility function
  useEffect(() => {
    return setupScrollToNodeListener(nodes, reactflow)
  }, [nodes, reactflow])

  const { schemaTypeDefinitions } = useMatchSchemaType()
  const { fetchInspectVars } = useSetWorkflowVarsWithValue()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)
  const dataSourceList = useStore(s => s.dataSourceList)
  // buildInTools, customTools, workflowTools, mcpTools, dataSourceList
  const configsMap = useHooksStore(s => s.configsMap)
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
          buildInTools,
          customTools,
          workflowTools,
          mcpTools,
          dataSourceList: dataSourceList ?? [],
        },
        passedInSchemaTypeDefinitions: schemaTypeDefinitions,
      })
    }
  }, [schemaTypeDefinitions, fetchInspectVars, isLoadedVars, vars, customTools, buildInTools, workflowTools, mcpTools, dataSourceList])

  const store = useStoreApi()
  if (process.env.NODE_ENV === 'development') {
    store.getState().onError = (code, message) => {
      if (code === '002')
        return
      console.warn(message)
    }
  }

  useEffect(() => {
    if (isDraggingNodeRef.current)
      return
    updateVisibleNodesByViewport()
  }, [nodes, updateVisibleNodesByViewport])

  useEffect(() => {
    if (isDraggingNodeRef.current)
      return

    const currentNodeIds = new Set(nodes.map(node => node.id))
    const nextSet = new Set<string>()
    let hasChanges = false
    visibleNodeIdSetRef.current.forEach((nodeId) => {
      if (currentNodeIds.has(nodeId))
        nextSet.add(nodeId)
      else
        hasChanges = true
    })

    if (hasChanges) {
      visibleNodeIdSetRef.current = nextSet
      setVisibleNodeIds(Array.from(nextSet))
    }
  }, [nodes])

  useEffect(() => {
    if (isDraggingNodeRef.current)
      return

    const visibleNodeIdSet = new Set(visibleNodeIds)
    setNodes((prevNodes) => {
      let hasChanges = false
      const nextNodes = prevNodes.map((node) => {
        const shouldBeVisible = visibleNodeIdSet.has(node.id)
        const isHidden = !!node.hidden
        if (isHidden === !shouldBeVisible)
          return node
        hasChanges = true
        return {
          ...node,
          hidden: !shouldBeVisible,
        }
      })
      return hasChanges ? nextNodes : prevNodes
    })
    setEdges((prevEdges) => {
      let hasChanges = false
      const nextEdges = prevEdges.map((edge) => {
        const shouldBeVisible = visibleNodeIdSet.has(edge.source) && visibleNodeIdSet.has(edge.target)
        const isHidden = !!edge.hidden
        if (isHidden === !shouldBeVisible)
          return edge
        hasChanges = true
        return {
          ...edge,
          hidden: !shouldBeVisible,
        }
      })
      return hasChanges ? nextEdges : prevEdges
    })
  }, [setEdges, setNodes, visibleNodeIds])

  const setDraggingState = useCallback((value: boolean) => {
    isDraggingNodeRef.current = value
    setIsDraggingNode(value)
  }, [])

  const handleNodeDragStartWithVisibility = useCallback<NodeDragHandler>((event, node) => {
    handleNodeDragStart(event, node)

    if (nodesReadOnly)
      return

    if (
      node.type === CUSTOM_ITERATION_START_NODE
      || node.type === CUSTOM_LOOP_START_NODE
      || node.type === CUSTOM_NOTE_NODE
    )
      return

    if (!isDraggingNodeRef.current)
      setDraggingState(true)
  }, [handleNodeDragStart, nodesReadOnly, setDraggingState])

  const handleNodeDragStopWithVisibility = useCallback<NodeDragHandler>((event, node) => {
    setDraggingState(false)
    handleNodeDragStop(event, node)
    updateVisibleNodesByViewport()
  }, [handleNodeDragStop, setDraggingState, updateVisibleNodesByViewport])

  return (
    <div
      id='workflow-container'
      className={cn(
        'relative h-full w-full min-w-[960px]',
        workflowReadOnly && 'workflow-panel-animation',
        nodeAnimation && 'workflow-node-animation',
        isDraggingNode && 'workflow-dragging',
      )}
      ref={workflowContainerRef}
    >
      <SyncingDataModal />
      <CandidateNode />
      <div
        className='pointer-events-none absolute left-0 top-0 z-10 flex w-12 items-center justify-center p-1 pl-2'
        style={{ height: controlHeight }}
      >
        <Control />
      </div>
      <Operator handleRedo={handleHistoryForward} handleUndo={handleHistoryBack} />
      { !isDraggingNode && <PanelContextmenu /> }
      { !isDraggingNode && <NodeContextmenu /> }
      { !isDraggingNode && <SelectionContextmenu /> }
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
      {children}
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
        onNodeDragStart={handleNodeDragStartWithVisibility}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStopWithVisibility}
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
        onSelectionContextMenu={handleSelectionContextMenu}
        connectionLineComponent={CustomConnectionLine}
        // NOTE: LOOP and ITERATION nodes currently share the same z-index styling.
        connectionLineContainerStyle={{ zIndex: ITERATION_CHILDREN_Z_INDEX }}
        defaultViewport={viewport}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        nodesDraggable={!nodesReadOnly}
        nodesConnectable={!nodesReadOnly}
        nodesFocusable={!nodesReadOnly}
        edgesFocusable={!nodesReadOnly}
        panOnScroll={false}
        panOnDrag={controlMode === ControlMode.Hand}
        zoomOnPinch={true}
        zoomOnScroll={true}
        zoomOnDoubleClick={true}
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
        edges={edges} >
        <DatasetsDetailProvider nodes={nodes}>
          {children}
        </DatasetsDetailProvider>
      </WorkflowHistoryProvider>
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWithDefaultContext)
