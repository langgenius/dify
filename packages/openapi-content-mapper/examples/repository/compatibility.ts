// Import existing type names from the mapper subpath, with no handwritten aliases.
// Only the import path changes; no customConditions are required.
// With the local OpenAPI Backend Navigation extension, F12 on DatasetCreatePayload
// opens its Python class; F12 on PostDatasetsData opens DatasetListApi.post.
// The same targets are available as "Open backend implementation" hover links.
import type {
  ClientOptions,
  DatasetCreatePayload,
  DatasetListItemResponse,
  GetDatasetsData,
  GetDatasetsResponse,
  GetDatasetsResponses,
  PostDatasetsData,
  PostDatasetsError,
  PostDatasetsErrors,
  PostDatasetsResponse,
  PostDatasetsResponses,
} from '@dify/openapi-content-mapper/console/datasets'
import type { AccessMode } from '@dify/openapi-content-mapper/enterprise'
import { AccessMode as AccessModes } from '@dify/contracts/enterprise/types.gen'

export const dataset: DatasetCreatePayload = {
  name: 'Product documentation',
  indexing_technique: 'high_quality',
  permission: 'only_me',
}

// Legacy request envelopes keep url and path, rather than adopting RPC params.
export const listRequest: GetDatasetsData = {
  url: '/datasets',
  query: { page: 1, limit: 20 },
}
export const createRequest: PostDatasetsData = { url: '/datasets', body: dataset }

export function datasetRows(response: GetDatasetsResponse): DatasetListItemResponse[] {
  return response.data
}

// Status-indexed responses and errors, their unions, and ClientOptions are exported too.
export function createdResponse(response: PostDatasetsResponses[201]): PostDatasetsResponse {
  return response
}
export function listResponse(response: GetDatasetsResponses[200]): GetDatasetsResponse {
  return response
}
export function conflictResponse(error: PostDatasetsErrors[409]): PostDatasetsError {
  return error
}
export const clientOptions: ClientOptions = { baseUrl: 'https://dify.example/console/api' }

// Runtime enum values still come from the original contracts module.
export const privateAccess: AccessMode = AccessModes.ACCESS_MODE_PRIVATE
