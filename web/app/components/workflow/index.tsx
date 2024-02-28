import type { FC } from 'react'
import { memo } from 'react'
import { useKeyPress } from 'ahooks'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type {
  Edge,
  Node,
} from './types'
import { useWorkflow } from './hooks'
import Header from './header'
import CustomNode from './nodes'
import ZoomInOut from './zoom-in-out'
import CustomEdge from './custom-edge'
import CustomConnectionLine from './custom-connection-line'
import Panel from './panel'

const nodeTypes = {
  custom: CustomNode,
}
const edgeTypes = {
  custom: CustomEdge,
}

type WorkflowProps = {
  nodes: Node[]
  edges: Edge[]
}
const Workflow: FC<WorkflowProps> = memo(({
  nodes: initialNodes,
  edges: initialEdges,
}) => {
  const [nodes] = useNodesState(initialNodes)
  const [edges, _, onEdgesChange] = useEdgesState(initialEdges)

  const {
    handleEnterNode,
    handleLeaveNode,
    handleConnectNode,
    handleEnterEdge,
    handleLeaveEdge,
    handleDeleteEdge,
  } = useWorkflow()

  useKeyPress('Backspace', handleDeleteEdge)

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
        onConnect={handleConnectNode}
        onNodeMouseEnter={handleEnterNode}
        onNodeMouseLeave={handleLeaveNode}
        onEdgeMouseEnter={handleEnterEdge}
        onEdgeMouseLeave={handleLeaveEdge}
        onEdgesChange={onEdgesChange}
        multiSelectionKeyCode={null}
        connectionLineComponent={CustomConnectionLine}
        deleteKeyCode={null}
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

const WorkflowWrap: FC<WorkflowProps> = ({
  nodes,
  edges,
}) => {
  return (
    <ReactFlowProvider>
      <Workflow
        nodes={nodes}
        edges={edges}
      />
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWrap)
