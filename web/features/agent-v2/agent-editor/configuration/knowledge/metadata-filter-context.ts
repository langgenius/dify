import type { ComponentProps, ComponentType } from 'react'
import type MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import { createContext } from 'react'

export type AgentWorkflowMetadataFilter = ComponentType<
  ComponentProps<typeof MetadataFilter> & { nodeId: string }
>

export const AgentMetadataFilterContext = createContext<{
  component: AgentWorkflowMetadataFilter
  nodeId: string
} | null>(null)
