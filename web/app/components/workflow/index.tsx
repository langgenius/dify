import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
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
import {
  useNodesInitialData,
  useWorkflow,
} from './hooks'
import Header from './header'
import CustomNode from './nodes'
import Operator from './operator'
import CustomEdge from './custom-edge'
import CustomConnectionLine from './custom-connection-line'
import Panel from './panel'
import Features from './features'
import { useStore } from './store'
import {
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import Loading from '@/app/components/base/loading'
import { FeaturesProvider } from '@/app/components/base/features'

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
  const showFeaturesPanel = useStore(state => state.showFeaturesPanel)
  const [nodes] = useNodesState(initialNodes)
  const [edges] = useEdgesState(initialEdges)

  const {
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleNodeEnter,
    handleNodeLeave,
    handleNodeClick,
    handleNodeConnect,

    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDelete,
    handleEdgesChange,
  } = useWorkflow()

  useKeyPress('Backspace', handleEdgeDelete)

  return (
    <div className='relative w-full h-full bg-[#F0F2F7]'>
      <Header />
      <Panel />
      <Operator />
      {
        showFeaturesPanel && <Features />
      }
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
        onConnect={handleNodeConnect}
        onEdgeMouseEnter={handleEdgeEnter}
        onEdgeMouseLeave={handleEdgeLeave}
        onEdgesChange={handleEdgesChange}
        multiSelectionKeyCode={null}
        connectionLineComponent={CustomConnectionLine}
        deleteKeyCode={null}
      >
        <Background
          gap={[14, 14]}
          size={2}
          color='#E4E5E7'
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
  const appId = useParams().appId
  const { data, isLoading, error } = useSWR(`/apps/${appId}/workflows/draft`, fetchWorkflowDraft)
  const nodesInitialData = useNodesInitialData()

  const startNode = {
    id: `${Date.now()}`,
    type: 'custom',
    data: nodesInitialData.start,
    position: {
      x: 100,
      y: 100,
    },
  }

  const nodesData = useMemo(() => {
    if (nodes)
      return nodes

    if (data)
      return data.graph.nodes

    return [startNode]
  }, [data, nodes])
  const edgesData = useMemo(() => {
    if (edges)
      return edges

    if (data)
      return data.graph.edges

    return []
  }, [data, nodes])

  if (error) {
    syncWorkflowDraft({
      url: `/apps/${appId}/workflows/draft`,
      params: {
        graph: {
          nodes: [startNode],
          edges: [],
        },
        features: {},
      },
    })
  }

  if (isLoading) {
    return (
      <Loading />
    )
  }

  return (
    <ReactFlowProvider>
      <FeaturesProvider>
        <Workflow
          nodes={nodesData}
          edges={edgesData}
        />
      </FeaturesProvider>
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWrap)
