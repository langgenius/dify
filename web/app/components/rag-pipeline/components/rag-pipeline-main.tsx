import {
  useMemo,
} from 'react'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import type { WorkflowProps } from '@/app/components/workflow'
import RagPipelineChildren from './rag-pipeline-children'
import {
  useAvailableNodesMetaData,
} from '../hooks'

type RagPipelineMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
const RagPipelineMain = ({
  nodes,
  edges,
  viewport,
}: RagPipelineMainProps) => {
  const availableNodesMetaData = useAvailableNodesMetaData()

  const hooksStore = useMemo(() => {
    return {
      availableNodesMetaData,
    }
  }, [
    availableNodesMetaData,
  ])

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      hooksStore={hooksStore as any}
    >
      <RagPipelineChildren />
    </WorkflowWithInnerContext>
  )
}

export default RagPipelineMain
