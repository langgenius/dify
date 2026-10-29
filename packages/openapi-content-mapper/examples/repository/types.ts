import type { Inputs, Outputs, Schemas } from './console.openapi-source'

// These types come from Dify's Python controllers through the Console exporter.
// Hover the aliases below to inspect the real fields; no running API is required.
export type DatasetCreatePayload = Schemas['console_DatasetCreatePayload']
export type TagResponse = Schemas['console_TagResponse']

// GET /datasets: the input is optional; its decoded response contains data + total.
export type ListDatasetsInput = Inputs['datasets']['get']
export type DatasetListQuery = NonNullable<ListDatasetsInput>['query']
export type DatasetListResponse = Outputs['datasets']['get']
export type DatasetListItem = DatasetListResponse['data'][number]

// POST /datasets: keep the full request and the form body available separately.
export type CreateDatasetInput = Inputs['datasets']['post']
export type CreateDatasetBody = CreateDatasetInput['body']
export type CreateDatasetResponse = Outputs['datasets']['post']

// POST /files/upload: multipart binary fields accept Blob/File, not JSON strings.
export type UploadFileBody = Inputs['files']['upload']['post']['body']
export type UploadFileResponse = Outputs['files']['upload']['post']

export const datasetDraft = {
  name: 'Product documentation',
  description: 'Knowledge base for product questions',
  indexing_technique: 'high_quality',
  permission: 'only_me',
} satisfies DatasetCreatePayload

export const createDatasetInput: CreateDatasetInput = { body: datasetDraft }
export const datasetListQuery: DatasetListQuery = { page: 1, limit: 20 }
export const datasetListInput: ListDatasetsInput = { query: datasetListQuery }

// Keep existing @dify/contracts names and envelopes in a compatibility module.
// This example does not replace the current generated contracts or send requests.
export type GetDatasetsData = {
  body?: never
  path?: never
  query?: DatasetListQuery
  url: '/datasets'
}

export type GetDatasetsResponse = DatasetListResponse

export type PostDatasetsData = {
  body: CreateDatasetBody
  path?: never
  query?: never
  url: '/datasets'
}

export type PostDatasetsResponse = CreateDatasetResponse
