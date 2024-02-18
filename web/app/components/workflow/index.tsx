import type { FC } from 'react'
import type { Edge } from 'reactflow'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
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
      <Panel />
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
  const [nodes] = useNodesState(initialNodes)
  const [edges] = useEdgesState(initialEdges)
  const {
    selectedNodeId,
    handleSelectedNodeIdChange,
    selectedNode,
  } = useWorkflow(nodes, initialSelectedNodeId)

  return (
    <WorkflowContext.Provider value={{
      selectedNodeId,
      handleSelectedNodeIdChange,
      selectedNode,
      nodes,
      edges,
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
