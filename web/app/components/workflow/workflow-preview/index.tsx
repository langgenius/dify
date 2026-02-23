'use client'

import type {
  EdgeChange,
  NodeChange,
  Viewport,
} from 'reactflow'
import type {
  Edge,
  Node,
} from '@/app/components/workflow/types'
import {
  useCallback,
  useState,
} from 'react'
import ReactFlow, {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  MiniMap,
  ReactFlowProvider,
  SelectionMode,
} from 'reactflow'
import {
  CUSTOM_EDGE,
  CUSTOM_NODE,
  ITERATION_CHILDREN_Z_INDEX,
} from '@/app/components/workflow/constants'
import CustomConnectionLine from '@/app/components/workflow/custom-connection-line'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '@/app/components/workflow/nodes/loop-start/constants'
import { CUSTOM_NOTE_NODE } from '@/app/components/workflow/note-node/constants'
import { CUSTOM_SIMPLE_NODE } from '@/app/components/workflow/simple-node/constants'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils/workflow-init'
import { cn } from '@/utils/classnames'
import CustomEdge from './components/custom-edge'
import CustomNode from './components/nodes'
import IterationStartNode from './components/nodes/iteration-start'
import LoopStartNode from './components/nodes/loop-start'
import CustomNoteNode from './components/note-node'
import ZoomInOut from './components/zoom-in-out'
import 'reactflow/dist/style.css'
import '../style.css'

const nodeTypes = {
  [CUSTOM_NODE]: CustomNode,
  [CUSTOM_NOTE_NODE]: CustomNoteNode,
  [CUSTOM_SIMPLE_NODE]: CustomNode,
  [CUSTOM_ITERATION_START_NODE]: IterationStartNode,
  [CUSTOM_LOOP_START_NODE]: LoopStartNode,
}
const edgeTypes = {
  [CUSTOM_EDGE]: CustomEdge,
}

type WorkflowPreviewProps = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
  className?: string
  miniMapToRight?: boolean
}
const WorkflowPreview = ({
  nodes,
  edges,
  viewport,
  className,
  miniMapToRight,
}: WorkflowPreviewProps) => {
  const [nodesData, setNodesData] = useState(() => initialNodes(nodes, edges))
  const [edgesData, setEdgesData] = useState(() => initialEdges(edges, nodes))

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodesData(nds => applyNodeChanges(changes, nds)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdgesData(eds => applyEdgeChanges(changes, eds)),
    [],
  )

  return (
    <div
      id="workflow-container"
      className={cn(
        'relative h-full w-full',
        className,
      )}
    >
      <>
        <MiniMap
          pannable
          zoomable
          style={{
            width: 102,
            height: 72,
          }}
          maskColor="var(--color-workflow-minimap-bg)"
          className={cn('!absolute !bottom-14 z-[9] !m-0 !h-[72px] !w-[102px] !rounded-lg !border-[0.5px] !border-divider-subtle !bg-background-default-subtle !shadow-md !shadow-shadow-shadow-5', miniMapToRight ? '!right-4' : '!left-4')}
        />
        <div className="absolute bottom-4 left-4 z-[9] mt-1 flex items-center gap-2">
          <ZoomInOut />
        </div>
      </>
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodesData}
        onNodesChange={onNodesChange}
        edges={edgesData}
        onEdgesChange={onEdgesChange}
        connectionLineComponent={CustomConnectionLine}
        connectionLineContainerStyle={{ zIndex: ITERATION_CHILDREN_Z_INDEX }}
        defaultViewport={viewport}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        nodesDraggable
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        panOnScroll={false}
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
      </ReactFlow>
    </div>
  )
}

const WorkflowPreviewWrapper = (props: WorkflowPreviewProps) => {
  return (
    <ReactFlowProvider>
      <WorkflowPreview {...props} />
    </ReactFlowProvider>
  )
}

export default WorkflowPreviewWrapper
