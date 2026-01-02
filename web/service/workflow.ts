import type { BlockEnum } from '@/app/components/workflow/types'
import type { CommonResponse } from '@/models/common'
import type { FlowType } from '@/types/common'
import type {
  ConversationVariableResponse,
  FetchWorkflowDraftPageResponse,
  FetchWorkflowDraftResponse,
  NodesDefaultConfigsResponse,
  NodeTracing,
  PublishWorkflowParams,
  UpdateWorkflowParams,
  VarInInspect,
  WorkflowRunHistoryResponse,
} from '@/types/workflow'
import { del, get, patch, post, put } from './base'
import { getFlowPrefix } from './utils'

export const fetchWorkflowDraft = (url: string) => {
  return get(url, {}, { silent: true }) as Promise<FetchWorkflowDraftResponse>
}

export const fetchAppWorkflow = (appID: string) => {
  return get<FetchWorkflowDraftResponse>(`/apps/${appID}/workflows/publish`)
}

export const fetchWorkflowRunHistory = (url: string) => {
  return get<WorkflowRunHistoryResponse>(url)
}

export const fetchWorkflowConfig = <T>(url: string) => {
  return get<T>(url)
}

export const fetchWorkflowVersionHistory = (url: string, params: { page: number, limit: number, user_id?: string, named_only?: boolean }) => {
  return get<FetchWorkflowDraftPageResponse>(url, { params })
}

export const updateWorkflow = (params: UpdateWorkflowParams) => {
  return patch(params.url, {
    body: {
      marked_name: params.title,
      marked_comment: params.releaseNotes,
    },
  })
}

export const deleteWorkflow = (url: string) => {
  return del(url)
}

export const publishWorkflow = (params: PublishWorkflowParams) => {
  return post<CommonResponse & { created_at: number }>(params.url, {
    body: {
      marked_name: params.title,
      marked_comment: params.releaseNotes,
    },
  })
}

export const fetchLastRun = (flowType: FlowType, flowId: string, nodeId: string) => {
  return get<NodeTracing>(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/last-run`, {}, {
    silent: true,
  })
}

export const fetchConversationVarValues = async (flowType: FlowType, flowId: string) => {
  const { items } = (await get(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/conversation-variables`)) as { items: VarInInspect[] }
  return items
}

export const resetConversationVar = (flowType: FlowType, flowId: string, varId: string) => {
  return put(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}/reset`)
}

export const fetchSysVarValues = async (flowType: FlowType, flowId: string) => {
  const { items } = (await get(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/system-variables`)) as { items: VarInInspect[] }
  return items
}

export const deleteAllInspectorVars = (flowType: FlowType, flowId: string) => {
  return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables`)
}

export const deleteNodeInspectorVars = (flowType: FlowType, flowId: string, nodeId: string) => {
  return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/variables`)
}

export const deleteInspectorVar = (flowType: FlowType, flowId: string, varId: string) => {
  return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}`)
}

export const editInspectorVar = (flowType: FlowType, flowId: string, payload: { varId: string, name?: string, value?: any }) => {
  const { varId, ...rest } = payload
  return patch(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}`, {
    body: rest,
  })
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
