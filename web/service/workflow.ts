import type { BlockEnum, ConversationVariable, EnvironmentVariable } from '@/app/components/workflow/types'
import type { WorkflowDraftFeaturesPayload } from '@/contract/console/workflow'
import type { CommonResponse } from '@/models/common'
import type { FlowType } from '@/types/common'
import type {
  ConversationVariableResponse,
  FetchWorkflowDraftResponse,
  NestedNodeGraphPayload,
  NestedNodeGraphResponse,
  NodesDefaultConfigsResponse,
  VarInInspect,
} from '@/types/workflow'
import { get, post } from './base'
import { consoleClient } from './client'
import { getFlowPrefix } from './utils'
import { sanitizeWorkflowDraftPayload } from './workflow-payload'

export type { WorkflowDraftFeaturesPayload } from '@/contract/console/workflow'

export const fetchWorkflowDraft = (url: string) => {
  return get(url, {}, { silent: true }) as Promise<FetchWorkflowDraftResponse>
}

export const syncWorkflowDraft = ({ url, params, canNotSaveEmpty }: {
  url: string
  params: Pick<FetchWorkflowDraftResponse, 'graph' | 'features' | 'environment_variables' | 'conversation_variables'>
  canNotSaveEmpty?: boolean
}) => {
  // when graph adn skill type changed, it would pass empty nodes array...Temp prevent sync in this case
  if (params.graph.nodes.length === 0 && canNotSaveEmpty) {
    throw new Error('Cannot sync workflow draft with zero nodes.')
  }
  const sanitized = sanitizeWorkflowDraftPayload(params)
  return post<CommonResponse & { updated_at: number, hash: string }>(url, { body: sanitized }, { silent: true })
}

export const fetchNodesDefaultConfigs = (url: string) => {
  return get<NodesDefaultConfigsResponse>(url)
}

export const fetchNestedNodeGraph = (flowType: FlowType, flowId: string, payload: NestedNodeGraphPayload) => {
  return post<NestedNodeGraphResponse>(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nested-node-graph`, { body: payload }, { silent: true })
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

// Environment Variables API
export const fetchEnvironmentVariables = async (appId: string): Promise<EnvironmentVariable[]> => {
  const response = await consoleClient.workflowDraft.environmentVariables({
    params: { appId },
  })
  return response.items
}

export const updateEnvironmentVariables = ({ appId, environmentVariables }: {
  appId: string
  environmentVariables: EnvironmentVariable[]
}) => {
  return consoleClient.workflowDraft.updateEnvironmentVariables({
    params: { appId },
    body: { environment_variables: environmentVariables },
  })
}

export const updateConversationVariables = ({ appId, conversationVariables }: {
  appId: string
  conversationVariables: ConversationVariable[]
}) => {
  return consoleClient.workflowDraft.updateConversationVariables({
    params: { appId },
    body: { conversation_variables: conversationVariables },
  })
}

export const updateFeatures = ({ appId, features }: {
  appId: string
  features: WorkflowDraftFeaturesPayload
}) => {
  return consoleClient.workflowDraft.updateFeatures({
    params: { appId },
    body: { features },
  })
}
