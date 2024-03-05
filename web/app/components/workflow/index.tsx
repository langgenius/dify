import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import useSWR from 'swr'
import { useKeyPress } from 'ahooks'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
} from 'reactflow'
import type { Viewport } from 'reactflow'
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
import HelpLine from './help-line'
import { useStore } from './store'
import {
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
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
  viewport?: Viewport
}
const Workflow: FC<WorkflowProps> = memo(({
  nodes: initialNodes,
  edges: initialEdges,
  viewport,
}) => {
  const showFeaturesPanel = useStore(state => state.showFeaturesPanel)
  const [nodes] = useNodesState(initialNodes)
  const [edges] = useEdgesState(initialEdges)

  const {
    handleSyncWorkflowDraft,

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

  useOnViewportChange({
    onEnd: () => handleSyncWorkflowDraft(),
  })

  useKeyPress('Backspace', handleEdgeDelete)

  return (
    <div className='relative w-full h-full bg-[#F0F2F7]'>
      <Header />
      <Panel />
      <Operator />
      {
        showFeaturesPanel && <Features />
      }
      <HelpLine />
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
        nodeDragThreshold={1}
        defaultViewport={viewport}
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
  const appDetail = useAppStore(state => state.appDetail)
  const { data, isLoading, error } = useSWR(appDetail?.id ? `/apps/${appDetail.id}/workflows/draft` : null, fetchWorkflowDraft)
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

  if (error && appDetail) {
    syncWorkflowDraft({
      url: `/apps/${appDetail.id}/workflows/draft`,
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
          viewport={data?.graph.viewport}
        />
      </FeaturesProvider>
    </ReactFlowProvider>
  )
}

export default memo(WorkflowWrap)
