import { describe, expect, it } from 'vite-plus/test'
import { consoleRouterContract } from './generated/api/console/router.gen.ts'
import { contract as openapiContract } from './generated/api/openapi/orpc.gen.ts'
import { contract as serviceContract } from './generated/api/service/orpc.gen.ts'
import { contract as webContract } from './generated/api/web/orpc.gen.ts'

type ErrorMapEntry = { status?: number; data?: unknown }

const errorEntries = (contract: unknown, trail: string[] = []): [string, ErrorMapEntry][] => {
  if (typeof contract !== 'object' || contract === null) return []
  const definition = (contract as { '~orpc'?: { errorMap?: Record<string, ErrorMapEntry> } })[
    '~orpc'
  ]
  if (definition)
    return Object.entries(definition.errorMap ?? {}).map(([code, entry]) => [
      `${trail.join('.')} ${code}`,
      entry,
    ])
  return Object.entries(contract).flatMap(([key, child]) => errorEntries(child, [...trail, key]))
}

const errorStatuses = (contract: unknown): Record<string, number | undefined> => {
  if (typeof contract !== 'object' || contract === null) return {}
  const errorMap = (contract as { '~orpc'?: { errorMap?: Record<string, ErrorMapEntry> } })['~orpc']
    ?.errorMap
  return Object.fromEntries(
    Object.entries(errorMap ?? {}).map(([code, entry]) => [code, entry.status]),
  )
}

describe('generated oRPC error maps', () => {
  it('declares unavailable-index errors on Console and Service retrieval operations', () => {
    expect(errorStatuses(consoleRouterContract.datasets.byDatasetId.hitTesting.post)).toMatchObject(
      {
        knowledge_index_unavailable: 503,
      },
    )
    expect(errorStatuses(serviceContract.datasets.byDatasetId.retrieve.post)).toMatchObject({
      knowledge_index_unavailable: 503,
    })
  })

  it.each([
    ['console', consoleRouterContract],
    ['openapi', openapiContract],
    ['service', serviceContract],
    ['web', webContract],
  ])('gives every documented %s error a status and a body schema', (_name, contract) => {
    const incomplete = errorEntries(contract)
      .filter(([, entry]) => typeof entry.status !== 'number' || entry.data === undefined)
      .map(([name]) => name)

    expect(incomplete).toEqual([])
  })

  // /openapi/v1 documents no per-operation business errors yet: its guards raise only
  // errors the surfaces treat as generic, which the open default error covers.
  it.each([
    ['console', consoleRouterContract],
    ['service', serviceContract],
    ['web', webContract],
  ])('declares business errors on %s operations', (_name, contract) => {
    expect(errorEntries(contract).length).toBeGreaterThan(0)
  })

  it('keeps console pipeline and document business errors on their operations', () => {
    expect(
      errorStatuses(consoleRouterContract.rag.pipelines.byPipelineId.workflows.publish.post),
    ).toEqual({
      dataset_concurrent_update: 409,
      draft_workflow_not_sync: 409,
    })
    expect(
      errorStatuses(
        consoleRouterContract.rag.pipelines.byPipelineId.workflows.published.datasource.nodes
          .byNodeId.preview.post,
      ),
    ).toEqual({ pipeline_not_found: 404 })
    expect(errorStatuses(consoleRouterContract.datasets.byDatasetId.retry.post)).toEqual({
      invalid_action: 400,
    })
    expect(
      errorStatuses(
        consoleRouterContract.datasets.byDatasetId.documents.byDocumentId.websiteSync.get,
      ),
    ).toEqual({
      archived_document_immutable: 403,
      invalid_action: 400,
    })
  })
})
