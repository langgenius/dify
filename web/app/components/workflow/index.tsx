import type { FC } from 'react'
import {
  memo,
  useEffect,
  useMemo,
} from 'react'
import produce from 'immer'
import type { Edge } from 'reactflow'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useEdgesState,
  // useNodesInitialized,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useWorkflow } from './hooks'
import Header from './header'
import CustomNode from './nodes'
import ZoomInOut from './zoom-in-out'
import CustomEdge from './custom-edge'
import CustomConnectionLine from './custom-connection-line'
import Panel from './panel'
import { BlockEnum, type Node } from './types'

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
  const initialData: {
    nodes: Node[]
    edges: Edge[]
    needUpdatePosition: boolean
  } = useMemo(() => {
    const start = initialNodes.find(node => node.data.type === BlockEnum.Start)

    if (start?.position) {
      return {
        nodes: initialNodes,
        edges: initialEdges,
        needUpdatePosition: false,
      }
    }

    return {
      nodes: produce(initialNodes, (draft) => {
        draft.forEach((node) => {
          node.position = { x: 0, y: 0 }
          node.data = { ...node.data, hidden: true }
        })
      }),
      edges: produce(initialEdges, (draft) => {
        draft.forEach((edge) => {
          edge.hidden = true
        })
      }),
      needUpdatePosition: true,
    }
  }, [initialNodes, initialEdges])
  // const nodesInitialized = useNodesInitialized({
  //   includeHiddenNodes: true,
  // })
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData.edges)

  const {
    handleEnterNode,
    handleLeaveNode,
    handleEnterEdge,
    handleLeaveEdge,
    handleSelectNode,
    handleInitialLayoutNodes,
  } = useWorkflow()

  // useEffect(() => {
  //   if (nodesInitialized)
  //     handleInitialLayoutNodes()
  // }, [nodesInitialized])

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
        connectionLineComponent={CustomConnectionLine}
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
