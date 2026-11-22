import type { ComponentProps } from 'react'
import { use } from 'react'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import { AgentMetadataFilterContext } from './metadata-filter-context'

export function AgentMetadataFilter(props: ComponentProps<typeof MetadataFilter>) {
  const workflowFilter = use(AgentMetadataFilterContext)
  if (!workflowFilter) return <MetadataFilter {...props} />

  const WorkflowMetadataFilter = workflowFilter.component
  return <WorkflowMetadataFilter {...props} nodeId={workflowFilter.nodeId} />
}
