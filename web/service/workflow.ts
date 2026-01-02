import type { BlockEnum } from '@/app/components/workflow/types'
import type { CommonResponse } from '@/models/common'
import type { FlowType } from '@/types/common'
import type {
  ConversationVariableResponse,
  FetchWorkflowDraftResponse,
  NodesDefaultConfigsResponse,
  VarInInspect,
} from '@/types/workflow'
import { get, post } from './base'
import { getFlowPrefix } from './utils'

export const fetchWorkflowDraft = (url: string) => {
  return get(url, {}, { silent: true }) as Promise<FetchWorkflowDraftResponse>
}

export const syncWorkflowDraft = ({ url, params }: {
  url: string
  params: Pick<FetchWorkflowDraftResponse, 'graph' | 'features' | 'environment_variables' | 'conversation_variables'>
}) => {
  return post<CommonResponse & { updated_at: number, hash: string }>(url, { body: params }, { silent: true })
}

export const fetchNodesDefaultConfigs = (url: string) => {
  return get<NodesDefaultConfigsResponse>(url)
}

export const singleNodeRun = (flowType: FlowType, flowId: string, nodeId: string, params: object) => {
  return post(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/run`, { body: params })
}

export const getIterationSingleNodeRunUrl = (flowType: FlowType, isChatFlow: boolean, flowId: string, nodeId: string) => {
  return `${getFlowPrefix(flowType)}/${flowId}/${isChatFlow ? 'advanced-chat/' : ''}workflows/draft/iteration/nodes/${nodeId}/run`
}

export const getLoopSingleNodeRunUrl = (flowType: FlowType, isChatFlow: boolean, flowId: string, nodeId: string) => {
  return `${getFlowPrefix(flowType)}/${flowId}/${isChatFlow ? 'advanced-chat/' : ''}workflows/draft/loop/nodes/${nodeId}/run`
}

export const fetchPublishedWorkflow = (url: string) => {
  return get<FetchWorkflowDraftResponse>(url)
}

export const stopWorkflowRun = (url: string) => {
  return post<CommonResponse>(url)
}

export const fetchNodeDefault = (appId: string, blockType: BlockEnum, query = {}) => {
  return get(`apps/${appId}/workflows/default-workflow-block-configs/${blockType}`, {
    params: { q: JSON.stringify(query) },
  })
}

export const fetchPipelineNodeDefault = (pipelineId: string, blockType: BlockEnum, query = {}) => {
  return get(`rag/pipelines/${pipelineId}/workflows/default-workflow-block-configs/${blockType}`, {
    params: { q: JSON.stringify(query) },
  })
}

export const fetchCurrentValueOfConversationVariable = ({
  url,
  params,
}: {
  url: string
  params: { conversation_id: string }
}) => {
  return get<ConversationVariableResponse>(url, { params })
}

const fetchAllInspectVarsOnePage = async (flowType: FlowType, flowId: string, page: number): Promise<{ total: number, items: VarInInspect[] }> => {
  return get(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables`, {
    params: { page, limit: 100 },
  })
}
export const fetchAllInspectVars = async (flowType: FlowType, flowId: string): Promise<VarInInspect[]> => {
  const res = await fetchAllInspectVarsOnePage(flowType, flowId, 1)
  const { items, total } = res
  if (total <= 100)
    return items

  const pageCount = Math.ceil(total / 100)
  const promises = []
  for (let i = 2; i <= pageCount; i++)
    promises.push(fetchAllInspectVarsOnePage(flowType, flowId, i))

  const restData = await Promise.all(promises)
  restData.forEach(({ items: item }) => {
    items.push(...item)
  })
  return items
}

export const fetchNodeInspectVars = async (flowType: FlowType, flowId: string, nodeId: string): Promise<VarInInspect[]> => {
  const { items } = (await get(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/variables`)) as { items: VarInInspect[] }
  return items
}

// Workflow pause/resume API types
export enum WorkflowPauseStatus {
  PAUSED = 'paused',
  RESUMED = 'resumed',
}

export enum ResumeAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export enum ResumeResult {
  SUCCESS = 'success',
  ERROR = 'error',
}

export type PauseReason = {
  type: string
  node_id: string
  pause_reason_text: string
}

export type WorkflowPauseInfo = {
  status: WorkflowPauseStatus
  pause_reason: PauseReason
  paused_at: string
  resumed_at: string | null
  resume_reason: string | null
}

export type WorkflowResumeRequest = {
  reason: string
  action: ResumeAction
}

export type WorkflowResumeResponse = {
  result: ResumeResult
  workflow_run_id: string
  status: string
  resumed_at: string
  resume_reason: string
}

// Get pause information for a workflow run
export const fetchWorkflowRunPauseInfo = (appId: string, runId: string) => {
  return get<WorkflowPauseInfo>(`apps/${appId}/workflow-runs/${runId}/pause-info`)
}

// Resume a paused workflow run
export const resumeWorkflowRun = (appId: string, runId: string, params: WorkflowResumeRequest) => {
  if (params.reason.length < 1 || params.reason.length > 500) {
    throw new Error('Reason must be between 1 and 500 characters')
  }
  return post<WorkflowResumeResponse>(`apps/${appId}/workflow-runs/${runId}/resume`, { body: params })
}
