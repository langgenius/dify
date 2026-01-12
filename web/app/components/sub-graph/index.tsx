import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SubGraphProps } from './types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { memo, useMemo } from 'react'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import SubGraphMain from './components/sub-graph-main'
import { useSubGraphInit, useSubGraphNodes, useSubGraphPersistence } from './hooks'
import { createSubGraphSlice } from './store'

const defaultViewport: Viewport = {
  x: 50,
  y: 50,
  zoom: 1,
}

const SubGraph: FC<SubGraphProps> = (props) => {
  const { toolNodeId, paramKey } = props

  const { loadSubGraphData } = useSubGraphPersistence({ toolNodeId, paramKey })
  const savedData = useMemo(() => loadSubGraphData(), [loadSubGraphData])

  const { initialNodes, initialEdges } = useSubGraphInit(props)

  const nodesSource = savedData?.nodes || initialNodes
  const edgesSource = savedData?.edges || initialEdges

  const { nodes, edges } = useSubGraphNodes(nodesSource, edgesSource)

  return (
    <WorkflowWithDefaultContext
      nodes={nodes}
      edges={edges}
    >
      <SubGraphMain
        nodes={nodes}
        edges={edges}
        viewport={defaultViewport}
        toolNodeId={toolNodeId}
        paramKey={paramKey}
      />
    </WorkflowWithDefaultContext>
  )
}

const SubGraphWrapper: FC<SubGraphProps> = (props) => {
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createSubGraphSlice as unknown as InjectWorkflowStoreSliceFn}
    >
      <SubGraph {...props} />
    </WorkflowContextProvider>
  )
}

export default memo(SubGraphWrapper)
