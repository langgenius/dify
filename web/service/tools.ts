import type {
  Collection,
  CustomCollectionBackend,
  CustomParamSchema,
  MCPServerDetail,
  Tool,
  ToolCredential,
  WorkflowToolProviderRequest,
  WorkflowToolProviderResponse,
} from '@/app/components/tools/types'
import type { RAGRecommendedPlugins, ToolWithProvider } from '@/app/components/workflow/types'
import type { AppIconType } from '@/types/app'
import { buildProviderQuery } from './_tools_util'
import { del, get, post, put } from './base'

export const fetchCollectionList = () => {
  return get<Collection[]>('/workspaces/current/tool-providers')
}

export const fetchCollectionDetail = (collectionName: string) => {
  return get<Collection>(`/workspaces/current/tool-provider/${collectionName}/info`)
}

export const fetchBuiltInToolList = (collectionName: string) => {
  return get<Tool[]>(`/workspaces/current/tool-provider/builtin/${collectionName}/tools`)
}

export const fetchCustomToolList = (collectionName: string) => {
  const query = buildProviderQuery(collectionName)
  return get<Tool[]>(`/workspaces/current/tool-provider/api/tools?${query}`)
}

export const fetchModelToolList = (collectionName: string) => {
  const query = buildProviderQuery(collectionName)
  return get<Tool[]>(`/workspaces/current/tool-provider/model/tools?${query}`)
}

export const fetchWorkflowToolList = (appID: string) => {
  return get<Tool[]>(`/workspaces/current/tool-provider/workflow/tools?workflow_tool_id=${appID}`)
}

export const fetchBuiltInToolCredentialSchema = (collectionName: string) => {
  return get<ToolCredential[]>(`/workspaces/current/tool-provider/builtin/${collectionName}/credentials_schema`)
}

export const fetchBuiltInToolCredential = (collectionName: string) => {
  return get<ToolCredential[]>(`/workspaces/current/tool-provider/builtin/${collectionName}/credentials`)
}
export const updateBuiltInToolCredential = (collectionName: string, credential: Record<string, any>) => {
  return post(`/workspaces/current/tool-provider/builtin/${collectionName}/update`, {
    body: {
      credentials: credential,
    },
  })
}

export const removeBuiltInToolCredential = (collectionName: string) => {
  return post(`/workspaces/current/tool-provider/builtin/${collectionName}/delete`, {
    body: {},
  })
}

export const parseParamsSchema = (schema: string) => {
  return post<{ parameters_schema: CustomParamSchema[], schema_type: string }>('/workspaces/current/tool-provider/api/schema', {
    body: {
      schema,
    },
  })
}

export const fetchCustomCollection = (collectionName: string) => {
  const query = buildProviderQuery(collectionName)
  return get<CustomCollectionBackend>(`/workspaces/current/tool-provider/api/get?${query}`)
}

export const createCustomCollection = (collection: CustomCollectionBackend) => {
  return post('/workspaces/current/tool-provider/api/add', {
    body: {
      ...collection,
    },
  })
}

export const updateCustomCollection = (collection: CustomCollectionBackend) => {
  return post('/workspaces/current/tool-provider/api/update', {
    body: {
      ...collection,
    },
  })
}

export const removeCustomCollection = (collectionName: string) => {
  return post('/workspaces/current/tool-provider/api/delete', {
    body: {
      provider: collectionName,
    },
  })
}

export const importSchemaFromURL = (url: string) => {
  return get('/workspaces/current/tool-provider/api/remote', {
    params: {
      url,
    },
  })
}

export const testAPIAvailable = (payload: any) => {
  return post('/workspaces/current/tool-provider/api/test/pre', {
    body: {
      ...payload,
    },
  })
}

export const createWorkflowToolProvider = (payload: WorkflowToolProviderRequest & { workflow_app_id: string }) => {
  return post('/workspaces/current/tool-provider/workflow/create', {
    body: { ...payload },
  })
}

export const saveWorkflowToolProvider = (payload: WorkflowToolProviderRequest & Partial<{
  workflow_app_id: string
  workflow_tool_id: string
}>) => {
  return post('/workspaces/current/tool-provider/workflow/update', {
    body: { ...payload },
  })
}

export const fetchWorkflowToolDetailByAppID = (appID: string) => {
  return get<WorkflowToolProviderResponse>(`/workspaces/current/tool-provider/workflow/get?workflow_app_id=${appID}`)
}

export const fetchWorkflowToolDetail = (toolID: string) => {
  return get<WorkflowToolProviderResponse>(`/workspaces/current/tool-provider/workflow/get?workflow_tool_id=${toolID}`)
}

export const deleteWorkflowTool = (toolID: string) => {
  return post('/workspaces/current/tool-provider/workflow/delete', {
    body: {
      workflow_tool_id: toolID,
    },
  })
}

export const fetchAllBuiltInTools = () => {
  return get<ToolWithProvider[]>('/workspaces/current/tools/builtin')
}

export const fetchAllCustomTools = () => {
  return get<ToolWithProvider[]>('/workspaces/current/tools/api')
}

export const fetchAllWorkflowTools = () => {
  return get<ToolWithProvider[]>('/workspaces/current/tools/workflow')
}

export const fetchAllMCPTools = () => {
  return get<ToolWithProvider[]>('/workspaces/current/tools/mcp')
}

export const createMCPProvider = (payload: {
  name: string
  server_url: string
  icon_type: AppIconType
  icon: string
  icon_background?: string | null
  timeout?: number
  sse_read_timeout?: number
  headers?: Record<string, string>
}) => {
  return post<ToolWithProvider>('workspaces/current/tool-provider/mcp', {
    body: {
      ...payload,
    },
  })
}

export const updateMCPProvider = (payload: {
  name: string
  server_url: string
  icon_type: AppIconType
  icon: string
  icon_background?: string | null
  provider_id: string
  timeout?: number
  sse_read_timeout?: number
  headers?: Record<string, string>
}) => {
  return put('workspaces/current/tool-provider/mcp', {
    body: {
      ...payload,
    },
  })
}

export const deleteMCPProvider = (id: string) => {
  return del('/workspaces/current/tool-provider/mcp', {
    body: {
      provider_id: id,
    },
  })
}

export const authorizeMCPProvider = (payload: { provider_id: string }) => {
  return post<{ result?: string, authorization_url?: string }>('/workspaces/current/tool-provider/mcp/auth', {
    body: payload,
  })
}

export const fetchMCPProviderToken = (payload: { provider_id: string, authorization_code: string }) => {
  return get<MCPServerDetail>('/workspaces/current/tool-provider/mcp/token', {
    params: {
      ...payload,
    },
  })
}

export const fetchMCPProviderTools = (providerID: string) => {
  return get<{ tools: Tool[] }>(`/workspaces/current/tool-provider/mcp/tools/${providerID}`)
}

export const updateMCPProviderTools = (providerID: string) => {
  return get<{ tools: Tool[] }>(`/workspaces/current/tool-provider/mcp/update/${providerID}`)
}

export const fetchMCPServerDetail = (appID: string) => {
  return get<MCPServerDetail>(`/apps/${appID}/server`)
}

export const createMCPServer = (payload: {
  appID: string
  description?: string
  parameters?: Record<string, string>
}) => {
  const { appID, ...rest } = payload
  return post(`apps/${appID}/server`, {
    body: {
      ...rest,
    },
  })
}

export const updateMCPServer = (payload: {
  appID: string
  id: string
  description?: string
  status?: string
  parameters?: Record<string, string>
}) => {
  const { appID, ...rest } = payload
  return put(`apps/${appID}/server`, {
    body: {
      ...rest,
    },
  })
}

export const refreshMCPServerCode = (appID: string) => {
  return get<MCPServerDetail>(`apps/${appID}/server/refresh`)
}

export const fetchBuiltinProviderInfo = (providerName: string) => {
  return get<Collection>(`/workspaces/current/tool-provider/builtin/${providerName}/info`)
}

export const fetchBuiltinProviderTools = (providerName: string) => {
  return get<Tool[]>(`/workspaces/current/tool-provider/builtin/${providerName}/tools`)
}

export const updateBuiltinProviderCredentials = (payload: { providerName: string, credentials: Record<string, any> }) => {
  const { providerName, credentials } = payload
  return post(`/workspaces/current/tool-provider/builtin/${providerName}/update`, {
    body: {
      credentials,
    },
  })
}

export const removeBuiltinProviderCredentials = (providerName: string) => {
  return post(`/workspaces/current/tool-provider/builtin/${providerName}/delete`, {
    body: {},
  })
}

export const fetchRAGRecommendedPlugins = (type: 'tool' | 'datasource' | 'all') => {
  return get<RAGRecommendedPlugins>('/rag/pipelines/recommended-plugins', {
    params: {
      type,
    },
  })
}

export type AppTrigger = {
  id: string
  trigger_type: 'trigger-webhook' | 'trigger-schedule' | 'trigger-plugin'
  title: string
  node_id: string
  provider_name: string
  icon: string
  status: 'enabled' | 'disabled' | 'unauthorized'
  created_at: string
  updated_at: string
}

export const fetchAppTriggers = (appId: string) => {
  return get<{ data: AppTrigger[] }>(`/apps/${appId}/triggers`)
}

export const updateAppTriggerStatus = (payload: {
  appId: string
  triggerId: string
  enableTrigger: boolean
}) => {
  const { appId, triggerId, enableTrigger } = payload
  return post<AppTrigger>(`/apps/${appId}/trigger-enable`, {
    body: {
      trigger_id: triggerId,
      enable_trigger: enableTrigger,
    },
  })
}
