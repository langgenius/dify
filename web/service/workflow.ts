import type { WorkflowFeaturesConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import type {
  BlockEnum,
  ConversationVariable,
  EnvironmentVariable,
} from '@/app/components/workflow/types'
import type { CommonResponse } from '@/models/common'
import type { FlowType } from '@/types/common'
import type {
  ConversationVariableResponse,
  FetchWorkflowDraftResponse,
  HumanInputFormData,
  NodesDefaultConfigsResponse,
  VarInInspect,
} from '@/types/workflow'
import { consoleClient } from '@/service/console'
import { get, post } from './base'
import { narrowResponse } from './console/narrow-response'
import { callByFlowType, getFlowPrefix } from './utils'

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
      force?: boolean
    }
}) => {
  return post<CommonResponse & { updated_at: number; hash: string }>(
    url,
    { body: params },
    { silent: true },
  )
}

export const fetchNodesDefaultConfigs = (url: string) => {
  return get<NodesDefaultConfigsResponse>(url)
}

export const singleNodeRun = (
  flowType: FlowType,
  flowId: string,
  nodeId: string,
  params: {
    inputs: Record<string, unknown>
    query?: string
    files?: Record<string, unknown>[]
  },
) => {
  return callByFlowType(flowType, {
    app: () =>
      consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.run.post({
        params: { app_id: flowId, node_id: nodeId },
        body: params,
      }),
    ragPipeline: () =>
      consoleClient.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.run.post({
        params: { pipeline_id: flowId, node_id: nodeId },
        body: params,
      }),
    snippet: () =>
      consoleClient.snippets.bySnippetId.workflows.draft.nodes.byNodeId.run.post({
        params: { snippet_id: flowId, node_id: nodeId },
        body: params,
      }),
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
  return consoleClient.apps.byAppId.workflows.defaultWorkflowBlockConfigs.byBlockType.get({
    params: { app_id: appId, block_type: blockType },
    query: { q: JSON.stringify(query) },
  })
}

export const fetchPipelineNodeDefault = (pipelineId: string, blockType: BlockEnum, query = {}) => {
  return consoleClient.rag.pipelines.byPipelineId.workflows.defaultWorkflowBlockConfigs.byBlockType.get(
    {
      params: { pipeline_id: pipelineId, block_type: blockType },
      query: { q: JSON.stringify(query) },
    },
  )
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
): Promise<{ total: number; items: VarInInspect[] }> => {
  return narrowResponse<{ total: number; items: VarInInspect[] }>(
    callByFlowType(flowType, {
      app: () =>
        consoleClient.apps.byAppId.workflows.draft.variables.get({
          params: { app_id: flowId },
          query: { page, limit: 100 },
        }),
      ragPipeline: () =>
        consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.get({
          params: { pipeline_id: flowId },
          query: { page, limit: 100 },
        }),
      snippet: () =>
        consoleClient.snippets.bySnippetId.workflows.draft.variables.get({
          params: { snippet_id: flowId },
          query: { page, limit: 100 },
        }),
    }),
  )
}
export const fetchAllInspectVars = async (
  flowType: FlowType,
  flowId: string,
): Promise<VarInInspect[]> => {
  const res = await fetchAllInspectVarsOnePage(flowType, flowId, 1)
  const { items, total } = res
  if (total <= 100) return items

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

export const fetchNodeInspectVars = async (
  flowType: FlowType,
  flowId: string,
  nodeId: string,
): Promise<VarInInspect[]> => {
  const { items } = await narrowResponse<{ items: VarInInspect[] }>(
    callByFlowType(flowType, {
      app: () =>
        consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.variables.get({
          params: { app_id: flowId, node_id: nodeId },
        }),
      ragPipeline: () =>
        consoleClient.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.variables.get({
          params: { pipeline_id: flowId, node_id: nodeId },
        }),
      snippet: () =>
        consoleClient.snippets.bySnippetId.workflows.draft.nodes.byNodeId.variables.get({
          params: { snippet_id: flowId, node_id: nodeId },
        }),
    }),
  )
  return items
}

export const updateEnvironmentVariables = ({
  appId,
  environmentVariables,
  deletedEnvironmentVariableIds,
}: {
  appId: string
} & EnvironmentVariablePatch) => {
  return consoleClient.apps.byAppId.workflows.draft.environmentVariables.post({
    params: { app_id: appId },
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
  return consoleClient.form.humanInput.byFormToken.post({
    params: { form_token: token },
    body: data,
  })
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
