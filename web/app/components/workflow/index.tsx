import type { FC } from 'react'
import type { Edge } from 'reactflow'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  WorkflowContext,
  useWorkflowContext,
} from './context'
import { useWorkflow } from './hooks'
import Header from './header'
import CustomNode, {
  Panel,
} from './nodes'
import AppInfoPanel from './app-info-panel'
import ZoomInOut from './zoom-in-out'
import CustomEdge from './custom-edge'
import type { Node } from './types'

const nodeTypes = {
  custom: CustomNode,
}
const edgeTypes = {
  custom: CustomEdge,
}

const Workflow = () => {
  const {
    nodes,
    edges,
  } = useWorkflowContext()

  return (
    <div className='relative w-full h-full'>
      <Header />
      <AppInfoPanel />
      <Panel />
      <ZoomInOut />
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
      >
        <Background
          gap={[14, 14]}
          size={1}
        />
      </ReactFlow>
    </div>
  )
}
type WorkflowWrapProps = {
  selectedNodeId?: string
  nodes: Node[]
  edges: Edge[]
}
const WorkflowWrap: FC<WorkflowWrapProps> = ({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId: initialSelectedNodeId,
}) => {
  const reactFlow = useReactFlow()
  const [nodes, setNodes] = useNodesState(initialNodes)
  const [edges, setEdges] = useEdgesState(initialEdges)
  const {
    selectedNodeId,
    handleSelectedNodeIdChange,
    selectedNode,
    handleAddNextNode,
    handleUpdateNodeData,
  } = useWorkflow(
    nodes,
    edges,
    setNodes,
    setEdges,
    initialSelectedNodeId,
  )

  return (
    <WorkflowContext.Provider value={{
      reactFlow,
      selectedNodeId,
      handleSelectedNodeIdChange,
      selectedNode,
      nodes,
      edges,
      handleAddNextNode,
      handleUpdateNodeData,
    }}>
      <Workflow />
    </WorkflowContext.Provider>
  )
}

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

export default WorkflowWrapWithReactFlowProvider
