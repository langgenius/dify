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
import { useWorkflow } from './hooks'
import Header from './header'
import CustomNode from './nodes'
import ZoomInOut from './zoom-in-out'
import CustomEdge from './custom-edge'
import Panel from './panel'
import type { Node } from './types'

const nodeTypes = {
  custom: CustomNode,
}
const edgeTypes = {
  custom: CustomEdge,
}

type WorkflowProps = {
  selectedNodeId?: string
  nodes: Node[]
  edges: Edge[]
}
const Workflow: FC<WorkflowProps> = memo(({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId: initialSelectedNodeId,
}) => {
  const [nodes] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const {
    handleEnterNode,
    handleLeaveNode,
    handleEnterEdge,
    handleLeaveEdge,
    handleSelectNode,
  } = useWorkflow()

  useEffect(() => {
    if (initialSelectedNodeId) {
      const initialSelectedNode = nodes.find(n => n.id === initialSelectedNodeId)

      if (initialSelectedNode)
        handleSelectNode({ id: initialSelectedNodeId, data: initialSelectedNode.data })
    }
  }, [initialSelectedNodeId])

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
        onNodeMouseEnter={handleEnterNode}
        onNodeMouseLeave={handleLeaveNode}
        onEdgesChange={onEdgesChange}
        onEdgeMouseEnter={handleEnterEdge}
        onEdgeMouseLeave={handleLeaveEdge}
        multiSelectionKeyCode={null}
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
  selectedNodeId,
  nodes,
  edges,
}) => {
  return (
    <ReactFlowProvider>
      {selectedNodeId}
      <Workflow
        selectedNodeId={selectedNodeId}
        nodes={nodes}
        edges={edges}
      />
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWrap)
