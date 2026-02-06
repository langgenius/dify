import type { AppListResponse } from '@/models/app'
import type { DataSetListResponse } from '@/models/datasets'
import type { BackendEdgeSpec, BackendNodeSpec, FlowchartGenRes } from '@/service/debug'
import { type } from '@orpc/contract'
import { base } from '../base'

// Search APIs
export const searchAppsContract = base
  .route({
    path: '/apps',
    method: 'GET',
  })
  .input(type<{
    query?: {
      page?: number
      limit?: number
      name?: string
    }
  }>())
  .output(type<AppListResponse>())

export const searchDatasetsContract = base
  .route({
    path: '/datasets',
    method: 'GET',
  })
  .input(type<{
    query?: {
      page?: number
      limit?: number
      keyword?: string
    }
  }>())
  .output(type<DataSetListResponse>())

// Vibe Workflow API
export type GenerateFlowchartInput = {
  instruction: string
  model_config: {
    provider: string
    name: string
    mode: string
    completion_params: Record<string, unknown>
  } | null
  available_nodes: Array<{
    type: string
    title?: string
    description?: string
  }>
  existing_nodes?: Array<{
    id: string
    type: string
    title?: string
  }>
  existing_edges?: BackendEdgeSpec[]
  available_tools: Array<{
    provider_id: string
    provider_name?: string
    provider_type?: string
    tool_name: string
    tool_label?: string
    tool_key?: string
    tool_description?: string
  }>
  selected_node_ids?: string[]
  previous_workflow?: {
    nodes: BackendNodeSpec[]
    edges: BackendEdgeSpec[]
    warnings?: string[]
  }
  regenerate_mode?: boolean
  language: string
  available_models?: Array<{
    provider: string
    model: string
  }>
}

export const generateFlowchartContract = base
  .route({
    path: '/flowchart-generate',
    method: 'POST',
  })
  .input(type<{
    body: GenerateFlowchartInput
  }>())
  .output(type<FlowchartGenRes>())
