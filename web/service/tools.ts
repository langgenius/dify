import { get, post } from './base'
import type {
  Collection,
  CustomCollectionBackend,
  CustomParamSchema,
  Tool,
  ToolCredential,
  WorkflowToolProviderRequest,
  WorkflowToolProviderResponse,
} from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { Label } from '@/app/components/tools/labels/constant'
import { buildProviderQuery } from './_tools_util'

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
  return post<{ parameters_schema: CustomParamSchema[]; schema_type: string }>('/workspaces/current/tool-provider/api/schema', {
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

export const fetchAllBuiltInTools = () => {
  return get<ToolWithProvider[]>('/workspaces/current/tools/builtin')
}

export const fetchAllCustomTools = () => {
  return get<ToolWithProvider[]>('/workspaces/current/tools/api')
}

export const fetchAllWorkflowTools = () => {
  return get<ToolWithProvider[]>('/workspaces/current/tools/workflow')
}

export const fetchLabelList = () => {
  return get<Label[]>('/workspaces/current/tool-labels')
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
