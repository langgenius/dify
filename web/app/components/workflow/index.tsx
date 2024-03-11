import type { FC } from 'react'
import {
  memo,
  useEffect,
  useMemo,
} from 'react'
import useSWR from 'swr'
import { useKeyPress } from 'ahooks'
import ReactFlow, {
  Background,
  ReactFlowProvider,
  useOnViewportChange,
} from 'reactflow'
import type { Viewport } from 'reactflow'
import 'reactflow/dist/style.css'
import type { ToolsMap } from './block-selector/types'
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
  initialEdges,
  initialNodes,
} from './utils'
import {
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { FeaturesProvider } from '@/app/components/base/features'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import { fetchCollectionList } from '@/service/tools'

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
  nodes,
  edges,
  viewport,
}) => {
  const showFeaturesPanel = useStore(state => state.showFeaturesPanel)

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
  const { data, isLoading, error, mutate } = useSWR(appDetail?.id ? `/apps/${appDetail.id}/workflows/draft` : null, fetchWorkflowDraft)
  const nodesInitialData = useNodesInitialData()

  useEffect(() => {
    if (data)
      useStore.setState({ draftUpdatedAt: data.updated_at })
  }, [data])

  const startNode = useMemo(() => {
    return {
      id: `${Date.now()}`,
      type: 'custom',
      data: nodesInitialData.start,
      position: {
        x: 100,
        y: 200,
      },
    }
  }, [nodesInitialData])

  const nodesData = useMemo(() => {
    if (nodes)
      return nodes

    if (data)
      return initialNodes(data.graph.nodes)

    return [startNode]
  }, [data, nodes, startNode])
  const edgesData = useMemo(() => {
    if (edges)
      return edges

    if (data)
      return initialEdges(data.graph.edges)

    return []
  }, [data, edges])

  const handleFetchCollectionList = async () => {
    const toolsets = await fetchCollectionList()

    useStore.setState({
      toolsets,
      toolsMap: toolsets.reduce((acc, toolset) => {
        acc[toolset.id] = []
        return acc
      }, {} as ToolsMap),
    })
  }

  useEffect(() => {
    handleFetchCollectionList()
  }, [])

  if (error && !error.bodyUsed && appDetail) {
    error.json().then((err: any) => {
      if (err.code === 'draft_workflow_not_exist') {
        syncWorkflowDraft({
          url: `/apps/${appDetail.id}/workflows/draft`,
          params: {
            graph: {
              nodes: [startNode],
              edges: [],
            },
            features: {},
          },
        }).then((res) => {
          useStore.setState({ draftUpdatedAt: res.updated_at })
          mutate()
        })
      }
    })
  }

  if (isLoading) {
    return (
      <div className='flex justify-center items-center relative w-full h-full bg-[#F0F2F7]'>
        <Loading />
      </div>
    )
  }

  if (!data)
    return null

  const features = data?.features || {}
  const initialFeatures: FeaturesData = {
    opening: {
      enabled: !!features.opening_statement,
      opening_statement: features.opening_statement,
      suggested_questions: features.suggested_questions,
    },
    suggested: features.suggested_questions_after_answer || { enabled: false },
    speech2text: features.speech_to_text || { enabled: false },
    text2speech: features.text_to_speech || { enabled: false },
    citation: features.retriever_resource || { enabled: false },
    moderation: features.sensitive_word_avoidance || { enabled: false },
    annotation: features.annotation_reply || { enabled: false },
  }

  return (
    <ReactFlowProvider>
      <FeaturesProvider features={initialFeatures}>
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
