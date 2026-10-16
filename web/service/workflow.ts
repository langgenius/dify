import type {
  DraftWorkflowNodeRunPayload,
  WorkflowFeaturesConfigPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
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
  NodesDefaultConfigsResponse,
  VarInInspect,
} from '@/types/workflow'
import { consoleClient } from '@/service/console'
import { get, post } from './base'

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
  resource: EditorResource,
  nodeId: string,
  body: DraftWorkflowNodeRunPayload,
) => {
  switch (resource.kind) {
    case 'app':
      return consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.run.post({
        params: { app_id: resource.appId, node_id: nodeId },
        body,
      })
    case 'knowledge-pipeline':
      return consoleClient.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.run.post({
        params: { pipeline_id: resource.pipelineId, node_id: nodeId },
        body,
      })
    case 'snippet':
      return consoleClient.snippets.bySnippetId.workflows.draft.nodes.byNodeId.run.post({
        params: { snippet_id: resource.snippetId, node_id: nodeId },
        body,
      })
  }
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

const fetchAllInspectVarsOnePage = (resource: EditorResource, page: number) => {
  switch (resource.kind) {
    case 'app':
      return consoleClient.apps.byAppId.workflows.draft.variables.get({
        params: { app_id: resource.appId },
        query: { page, limit: 100 },
      })
    case 'knowledge-pipeline':
      return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.get({
        params: { pipeline_id: resource.pipelineId },
        query: { page, limit: 100 },
      })
    case 'snippet':
      return consoleClient.snippets.bySnippetId.workflows.draft.variables.get({
        params: { snippet_id: resource.snippetId },
        query: { page, limit: 100 },
      })
  }
}
export const fetchAllInspectVars = async (resource: EditorResource): Promise<VarInInspect[]> => {
  const res = await fetchAllInspectVarsOnePage(resource, 1)
  const { items, total } = res
  if ((total ?? 0) <= 100) return items

  const pageCount = Math.ceil((total ?? 0) / 100)
  const promises = []
  for (let i = 2; i <= pageCount; i++) promises.push(fetchAllInspectVarsOnePage(resource, i))

  const restData = await Promise.all(promises)
  restData.forEach(({ items: item }) => {
    items.push(...item)
  })
  return items
}

export const fetchNodeInspectVars = async (resource: EditorResource, nodeId: string) => {
  switch (resource.kind) {
    case 'app': {
      const { items } =
        await consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.variables.get({
          params: { app_id: resource.appId, node_id: nodeId },
        })
      return items
    }
    case 'knowledge-pipeline': {
      const { items } =
        await consoleClient.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.variables.get(
          { params: { pipeline_id: resource.pipelineId, node_id: nodeId } },
        )
      return items
    }
    case 'snippet': {
      const { items } =
        await consoleClient.snippets.bySnippetId.workflows.draft.nodes.byNodeId.variables.get({
          params: { snippet_id: resource.snippetId, node_id: nodeId },
        })
      return items
    }
  }
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
