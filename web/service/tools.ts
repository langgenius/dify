import type {
  Credential,
  CustomCollectionBackend,
  ToolCredential,
  WorkflowToolProviderParameter,
  WorkflowToolProviderRequest,
} from '@/app/components/tools/types'
import {
  selectApiSchemaParameters,
  selectBuiltinProviderTools,
  selectCustomCollection,
  selectToolCollections,
  selectWorkflowToolDetail,
} from '@/app/components/tools/utils/query-select'
// oxlint-disable-next-line no-restricted-imports -- legacy built-in credential flow, see below
import { get, post } from './base'
import { consoleClient } from './console'

const toolProvider = consoleClient.workspaces.current.toolProvider

type ApiToolSchemaType = 'openai_actions' | 'openai_plugin' | 'openapi' | 'swagger'

type WorkflowToolParameterForm = 'form' | 'llm' | 'schema'

// The workflow tool editor keeps parameter forms as select values; the backend validates them.
const toWorkflowToolParameters = (parameters: WorkflowToolProviderParameter[]) =>
  parameters.map((parameter) => ({
    ...parameter,
    form: parameter.form as WorkflowToolParameterForm,
  }))

// The custom tool editor keeps `schema_type` as a free string until a schema is parsed;
// the backend validates the value.
const toSchemaType = (schemaType: string) => schemaType as ApiToolSchemaType

export const fetchCollectionList = () => {
  return consoleClient.workspaces.current.toolProviders.get({}).then(selectToolCollections)
}

export const fetchBuiltInToolList = (collectionName: string) => {
  return toolProvider.builtin.byProvider.tools
    .get({ params: { provider: collectionName } })
    .then(selectBuiltinProviderTools)
}

export const fetchCustomToolList = (collectionName: string) => {
  return toolProvider.api.tools
    .get({ query: { provider: collectionName } })
    .then(selectBuiltinProviderTools)
}

export const fetchWorkflowToolList = (appID: string) => {
  return toolProvider.workflow.tools
    .get({ query: { workflow_tool_id: appID } })
    .then(selectBuiltinProviderTools)
}

// Not migrated to the console contract: this legacy built-in credential flow predates
// multi-credential tool auth. The backend now serves the schema at
// `credential/schema/{credential_type}`, returns a credential list from `credentials`, and
// requires `credential_id` for update/delete. Only providers without a plugin reach it, and
// none of the remaining hard-coded built-in providers require credentials.
export const fetchBuiltInToolCredentialSchema = (collectionName: string) => {
  return get<ToolCredential[]>(
    `/workspaces/current/tool-provider/builtin/${collectionName}/credentials_schema`,
  )
}

export const fetchBuiltInToolCredential = (collectionName: string) => {
  return get<Record<string, unknown>>(
    `/workspaces/current/tool-provider/builtin/${collectionName}/credentials`,
  )
}

export const updateBuiltInToolCredential = (
  collectionName: string,
  credential: Record<string, unknown>,
) => {
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
  return toolProvider.api.schema.post({ body: { schema } }).then(selectApiSchemaParameters)
}

export const fetchCustomCollection = (collectionName: string) => {
  return toolProvider.api.get
    .get({ query: { provider: collectionName } })
    .then(selectCustomCollection)
}

export const createCustomCollection = (collection: CustomCollectionBackend) => {
  return toolProvider.api.add.post({
    body: { ...collection, schema_type: toSchemaType(collection.schema_type) },
  })
}

export const updateCustomCollection = (collection: CustomCollectionBackend) => {
  return toolProvider.api.update.post({
    body: {
      ...collection,
      // A collection that was not renamed keeps its current name as the original one.
      original_provider: collection.original_provider ?? collection.provider,
      schema_type: toSchemaType(collection.schema_type),
    },
  })
}

export const removeCustomCollection = (collectionName: string) => {
  return toolProvider.api.delete.post({ body: { provider: collectionName } })
}

export const importSchemaFromURL = (url: string) => {
  return toolProvider.api.remote.get({ query: { url } })
}

export const testAPIAvailable = (payload: {
  provider_name: string
  tool_name: string
  credentials: Credential
  schema_type: string
  schema: string
  parameters: Record<string, string>
}) => {
  return toolProvider.api.test.pre.post({
    body: { ...payload, schema_type: toSchemaType(payload.schema_type) },
  })
}

export const createWorkflowToolProvider = (
  payload: WorkflowToolProviderRequest & { workflow_app_id: string },
) => {
  return toolProvider.workflow.create.post({
    body: { ...payload, parameters: toWorkflowToolParameters(payload.parameters) },
  })
}

export const saveWorkflowToolProvider = (
  payload: WorkflowToolProviderRequest &
    Partial<{
      workflow_app_id: string
      workflow_tool_id: string
    }>,
) => {
  const { workflow_tool_id } = payload
  if (!workflow_tool_id) throw new Error('workflow_tool_id is required to update a workflow tool')
  return toolProvider.workflow.update.post({
    body: {
      ...payload,
      workflow_tool_id,
      parameters: toWorkflowToolParameters(payload.parameters),
    },
  })
}

export const fetchWorkflowToolDetail = (toolID: string) => {
  return toolProvider.workflow.get
    .get({ query: { workflow_tool_id: toolID } })
    .then(selectWorkflowToolDetail)
}

export const deleteWorkflowTool = (toolID: string) => {
  return toolProvider.workflow.delete.post({ body: { workflow_tool_id: toolID } })
}
