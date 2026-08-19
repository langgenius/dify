import type { WorkflowFeaturesConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import type {
  BlockEnum,
  ConversationVariable,
  EnvironmentVariable,
} from '@/app/components/workflow/types'
import type { CommonResponse } from '@/models/common'
import type {
  ConversationVariableResponse,
  FetchWorkflowDraftResponse,
  HumanInputFormData,
  VarInInspect,
} from '@/types/workflow'
import { FlowType } from '@/types/common'
import { get, post } from './base'
import { consoleClient } from './client'
import { getFlowPrefix } from './utils'

export type WorkflowDraftFeaturesPayload = WorkflowFeaturesConfigPayload

export type EnvironmentVariablePatch = {
  environmentVariables: EnvironmentVariable[]
  deletedEnvironmentVariableIds: string[]
}

type EnvironmentVariablePatchPayload = {
  environment_variables: EnvironmentVariable[]
  deleted_environment_variable_ids: string[]
}

export const fetchWorkflowDraft = (url: string) => {
  return get(url, {}, { silent: true }) as Promise<FetchWorkflowDraftResponse>
}

export const syncWorkflowDraft = ({
  url,
  params,
}: {
  url: string
  params: Pick<FetchWorkflowDraftResponse, 'graph' | 'features' | 'conversation_variables'> &
    Partial<Pick<FetchWorkflowDraftResponse, 'environment_variables'>> & {
      environment_variable_patch?: EnvironmentVariablePatchPayload
    }
}) => {
  return post<CommonResponse & { updated_at: number; hash: string }>(
    url,
    { body: params },
    { silent: true },
  )
}

export const singleNodeRun = (
  flowType: FlowType,
  flowId: string,
  nodeId: string,
  params: object,
) => {
  return post(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/run`, {
    body: params,
  })
}

export const getIterationSingleNodeRunUrl = (
  flowType: FlowType,
  isChatFlow: boolean,
  flowId: string,
  nodeId: string,
) => {
  return `${getFlowPrefix(flowType)}/${flowId}/${isChatFlow ? 'advanced-chat/' : ''}workflows/draft/iteration/nodes/${nodeId}/run`
}

export const getLoopSingleNodeRunUrl = (
  flowType: FlowType,
  isChatFlow: boolean,
  flowId: string,
  nodeId: string,
) => {
  return `${getFlowPrefix(flowType)}/${flowId}/${isChatFlow ? 'advanced-chat/' : ''}workflows/draft/loop/nodes/${nodeId}/run`
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

const fetchAllInspectVarsOnePage = async (
  flowType: FlowType,
  flowId: string,
  page: number,
  signal?: AbortSignal,
): Promise<{ total: number; items: VarInInspect[] }> => {
  const query = { page, limit: 100 }
  let response

  if (flowType === FlowType.ragPipeline) {
    response = await consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.get(
      { params: { pipeline_id: flowId }, query },
      { signal },
    )
  } else if (flowType === FlowType.snippet) {
    response = await consoleClient.snippets.bySnippetId.workflows.draft.variables.get(
      { params: { snippet_id: flowId }, query },
      { signal },
    )
  } else {
    response = await consoleClient.apps.byAppId.workflows.draft.variables.get(
      { params: { app_id: flowId }, query },
      { signal },
    )
  }

  return {
    items: (response.items ?? []) as VarInInspect[],
    total: response.total ?? 0,
  }
}

export const fetchAllInspectVars = async (
  flowType: FlowType,
  flowId: string,
  signal?: AbortSignal,
): Promise<VarInInspect[]> => {
  const res = await fetchAllInspectVarsOnePage(flowType, flowId, 1, signal)
  const { items, total } = res
  if (total <= 100) return items

  const pageCount = Math.ceil(total / 100)
  const promises = []
  for (let i = 2; i <= pageCount; i++)
    promises.push(fetchAllInspectVarsOnePage(flowType, flowId, i, signal))

  const restData = await Promise.all(promises)
  restData.forEach(({ items: item }) => {
    items.push(...item)
  })
  return items
}

export const fetchNodeInspectVars = async (
  flowType: FlowType,
  flowId: string,
  nodeId: string,
): Promise<VarInInspect[]> => {
  const { items } = (await get(
    `${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/variables`,
  )) as { items: VarInInspect[] }
  return items
}

export const updateEnvironmentVariables = ({
  appId,
  environmentVariables,
  deletedEnvironmentVariableIds,
}: {
  appId: string
} & EnvironmentVariablePatch) => {
  return post<CommonResponse>(`apps/${appId}/workflows/draft/environment-variables`, {
    body: {
      environment_variables: environmentVariables,
      patch: true,
      deleted_environment_variable_ids: deletedEnvironmentVariableIds,
    },
  })
}

export const updateConversationVariables = ({
  appId,
  conversationVariables,
}: {
  appId: string
  conversationVariables: ConversationVariable[]
}) => {
  return consoleClient.apps.byAppId.workflows.draft.conversationVariables.post({
    params: { app_id: appId },
    body: { conversation_variables: conversationVariables },
  })
}

export const updateFeatures = ({
  appId,
  features,
}: {
  appId: string
  features: WorkflowDraftFeaturesPayload
}) => {
  return consoleClient.apps.byAppId.workflows.draft.features.post({
    params: { app_id: appId },
    body: { features },
  })
}

export const submitHumanInputForm = (
  token: string,
  data: {
    inputs: Record<string, unknown>
    action: string
  },
) => {
  return post(`/form/human_input/${token}`, { body: data })
}

export const fetchHumanInputNodeStepRunForm = (
  url: string,
  data: {
    inputs: Record<string, unknown>
  },
) => {
  return post<HumanInputFormData>(`${url}/preview`, { body: data })
}

export const submitHumanInputNodeStepRunForm = (
  url: string,
  data: {
    inputs: Record<string, unknown> | undefined
    form_inputs: Record<string, unknown> | undefined
    action: string
  },
) => {
  return post<CommonResponse>(`${url}/run`, { body: data })
}
