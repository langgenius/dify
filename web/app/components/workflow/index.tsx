import type { FC } from 'react'
import { memo, useEffect } from 'react'
import type { Edge } from 'reactflow'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import './style.css'
import {
  WorkflowContext,
  useWorkflowContext,
} from './context'
import { useWorkflow } from './hooks'
import Header from './header'
import CustomNode from './nodes'
import ZoomInOut from './zoom-in-out'
import CustomEdge from './custom-edge'
import Panel from './panel'
import type { Node } from './types'
import { useStore } from './store'

const nodeTypes = {
  custom: CustomNode,
}
const edgeTypes = {
  custom: CustomEdge,
}

const Workflow = memo(() => {
  const {
    nodes,
    edges,
  } = useWorkflowContext()
  const handleEnterEdge = useStore(state => state.handleEnterEdge)
  const handleLeaveEdge = useStore(state => state.handleLeaveEdge)

  return (
    <div className='relative w-full h-full'>
      <Header />
      <Panel />
      <ZoomInOut />
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
        onEdgeMouseEnter={handleEnterEdge}
        onEdgeMouseLeave={handleLeaveEdge}
      >
        <Background
          gap={[14, 14]}
          size={1}
        />
      </ReactFlow>
    </div>
  )
})
Workflow.displayName = 'Workflow'

type WorkflowWrapProps = {
  selectedNodeId?: string
  nodes: Node[]
  edges: Edge[]
}
const WorkflowWrap: FC<WorkflowWrapProps> = memo(({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId: initialSelectedNodeId,
}) => {
  const [nodes, setNodes] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const {
    handleAddNextNode,
    handleUpdateNodeData,
    handleEnterEdge,
    handleLeaveEdge,
  } = useWorkflow(
    nodes,
    edges,
    setNodes,
    setEdges,
  )
  const handleSelectedNodeId = useStore(state => state.handleSelectedNodeId)
  useEffect(() => {
    if (initialSelectedNodeId)
      handleSelectedNodeId(initialSelectedNodeId)
  }, [initialSelectedNodeId, handleSelectedNodeId])
  // const handleEnterEdge = useStore(state => state.handleEnterEdge)
  // const handleLeaveEdge = useStore(state => state.handleLeaveEdge)

  return (
    <WorkflowContext.Provider value={{
      mode: 'workflow',
      nodes,
      edges,
      handleAddNextNode,
      handleUpdateNodeData,
    }}>
      <div className='relative w-full h-full'>
        <Header />
        <Panel />
        <ZoomInOut />
        <ReactFlow
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodes={nodes}
          edges={edges}
          onEdgesChange={onEdgesChange}
          onEdgeMouseEnter={handleEnterEdge}
          onEdgeMouseLeave={handleLeaveEdge}
        >
          <Background
            gap={[14, 14]}
            size={1}
          />
        </ReactFlow>
      </div>
    </WorkflowContext.Provider>
  )
})

WorkflowWrap.displayName = 'WorkflowWrap'

const WorkflowWrapWithReactFlowProvider: FC<WorkflowWrapProps> = ({
  selectedNodeId,
  nodes,
  edges,
}) => {
  return (
    <ReactFlowProvider>
      {selectedNodeId}
      <WorkflowWrap
        selectedNodeId={selectedNodeId}
        nodes={nodes}
        edges={edges}
      />
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWrapWithReactFlowProvider)
