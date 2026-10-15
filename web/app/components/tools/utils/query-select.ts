import type {
  AppMcpServerResponse,
  WorkflowTriggerListResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { RagPipelineOpaqueResponse } from '@dify/contracts/api/console/rag/types.gen'
import type {
  ToolApiListResponse,
  ToolProviderApiEntityResponse,
  ToolProviderListResponse,
  WorkflowToolDetailResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  AppTrigger,
  Collection,
  MCPServerDetail,
  Tool,
  WorkflowToolProviderResponse,
} from '../types'
import type { RAGRecommendedPlugins, ToolWithProvider } from '@/app/components/workflow/types'

// The tool UI types narrow provider types, statuses, icons and parameter schemas that the
// backend declares as plain strings and loose records.
export const selectToolCollections = (data: ToolProviderListResponse) =>
  data as unknown as Collection[]

export const selectToolsWithProvider = (data: ToolProviderListResponse) =>
  data as unknown as ToolWithProvider[]

export const selectToolProvider = (data: ToolProviderApiEntityResponse) =>
  data as unknown as ToolWithProvider

export const selectToolProviderTools = (data: ToolProviderApiEntityResponse) =>
  data as unknown as { tools: Tool[] }

export const selectBuiltinProviderTools = (data: ToolApiListResponse) => data as unknown as Tool[]

export const selectMCPServerDetail = (data: AppMcpServerResponse) =>
  data as unknown as MCPServerDetail

export const selectWorkflowToolDetail = (data: WorkflowToolDetailResponse) =>
  data as unknown as WorkflowToolProviderResponse

export const selectAppTriggers = (data: WorkflowTriggerListResponse) =>
  data as unknown as { data: AppTrigger[] }

export const selectRAGRecommendedPlugins = (data: RagPipelineOpaqueResponse) =>
  data as unknown as RAGRecommendedPlugins
