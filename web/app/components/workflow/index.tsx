import type { FC } from 'react'
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

const nodeTypes = {
  custom: CustomNode,
}
const edgeTypes = {
  custom: CustomEdge,
}

const initialNodes = [
  {
    id: '1',
    type: 'custom',
    position: { x: 330, y: 30 },
    data: { type: 'start' },
  },
  {
    id: '2',
    type: 'custom',
    position: { x: 330, y: 212 },
    data: { type: 'start' },
  },
  {
    id: '3',
    type: 'custom',
    position: { x: 150, y: 394 },
    data: { type: 'start' },
  },
  {
    id: '4',
    type: 'custom',
    position: { x: 510, y: 394 },
    data: { type: 'start' },
  },
]

const initialEdges = [
  {
    id: '1',
    source: '1',
    target: '2',
    type: 'custom',
  },
  {
    id: '2',
    source: '2',
    target: '3',
    type: 'custom',
  },
  {
    id: '3',
    source: '2',
    target: '4',
    type: 'custom',
  },
]

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

const WorkflowWrap: FC = () => {
  const [nodes] = useNodesState(initialNodes)
  const [edges] = useEdgesState(initialEdges)
  const {
    selectedNodeId,
    handleSelectedNodeIdChange,
    selectedNode,
  } = useWorkflow(nodes)

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

const WorkflowWrapWithReactFlowProvider = () => {
  return (
    <ReactFlowProvider>
      <WorkflowWrap />
    </ReactFlowProvider>
  )
}

export default WorkflowWrapWithReactFlowProvider
