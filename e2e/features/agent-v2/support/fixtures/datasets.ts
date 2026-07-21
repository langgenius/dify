import type {
  ConsoleSegmentListResponse,
  DatasetListItemResponse,
  DocumentStatusListResponse,
  DocumentWithSegmentsListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { DifyWorld } from '../../../support/world'
import type { PreseededResource } from './common'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'
import {
  agentBuilderExpectedTokens,
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from '../agent-builder-resources'
import { buildQuery, failFixturePrerequisite, findConsoleResourceByName } from './common'

type DocumentIndexingStatus =
  | 'cleaning'
  | 'completed'
  | 'indexing'
  | 'parsing'
  | 'splitting'
  | 'waiting'

const completedDocumentIndexingStatus: DocumentIndexingStatus = 'completed'
export const getPreseededDataset = async (resourceName: string) => {
  const query = buildQuery({ keyword: resourceName, limit: '20', page: '1' })

  return findConsoleResourceByName<DatasetListItemResponse>({
    action: `Check preseeded dataset ${resourceName}`,
    path: `/console/api/datasets?${query}`,
    resourceName,
  })
}

const getDatasetIndexingStatuses = async (datasetId: string, resourceName: string) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/datasets/${datasetId}/indexing-status`)
    await expectApiResponseOK(response, `Check preseeded dataset indexing status ${resourceName}`)
    const body = (await response.json()) as DocumentStatusListResponse

    return body.data
  } finally {
    await ctx.dispose()
  }
}

const getDatasetDocuments = async (datasetId: string, resourceName: string) => {
  const documents: DocumentWithSegmentsListResponse['data'] = []
  const ctx = await createApiContext()
  try {
    let page = 1
    let hasMore = true

    while (hasMore) {
      const query = buildQuery({ limit: '100', page: String(page) })
      const response = await ctx.get(`/console/api/datasets/${datasetId}/documents?${query}`)
      await expectApiResponseOK(response, `List preseeded dataset documents ${resourceName}`)
      const body = (await response.json()) as DocumentWithSegmentsListResponse

      documents.push(...body.data)
      hasMore = body.has_more
      page += 1
    }

    return documents
  } finally {
    await ctx.dispose()
  }
}

const datasetHasEnabledSegmentContainingTokens = async (
  datasetId: string,
  resourceName: string,
  expectedTokens: string[],
) => {
  const documents = await getDatasetDocuments(datasetId, resourceName)
  const ctx = await createApiContext()
  try {
    for (const document of documents) {
      const query = buildQuery({
        enabled: 'true',
        keyword: agentBuilderExpectedTokens.knowledgeReply,
        limit: '20',
        page: '1',
      })
      const response = await ctx.get(
        `/console/api/datasets/${datasetId}/documents/${document.id}/segments?${query}`,
      )
      await expectApiResponseOK(response, `Check preseeded dataset segment content ${resourceName}`)
      const body = (await response.json()) as ConsoleSegmentListResponse
      const matchingSegment = body.data.find(
        (segment) =>
          segment.enabled &&
          expectedTokens.every(
            (expectedToken) =>
              segment.content.includes(expectedToken) ||
              segment.keywords?.some((keyword) => keyword.includes(expectedToken)),
          ),
      )

      if (matchingSegment) return true
    }

    return false
  } finally {
    await ctx.dispose()
  }
}

const toDatasetResource = (resource: DatasetListItemResponse): PreseededResource => ({
  id: resource.id,
  kind: 'dataset',
  name: resource.name,
})

export async function requireReadyPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<PreseededResource> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return failFixturePrerequisite(world, `Preseeded dataset "${resourceName}" was not found.`)

  if (resource.document_count < 1) {
    return failFixturePrerequisite(world, `Preseeded dataset "${resourceName}" has no documents.`)
  }

  if (resource.total_available_documents !== resource.document_count) {
    return failFixturePrerequisite(
      world,
      `Preseeded dataset "${resourceName}" has ${resource.total_available_documents}/${resource.document_count} available documents.`,
    )
  }

  const statuses = await getDatasetIndexingStatuses(resource.id, resourceName)
  if (statuses.length < 1) {
    return failFixturePrerequisite(
      world,
      `Preseeded dataset "${resourceName}" has no document indexing status.`,
    )
  }

  const incompleteStatus = statuses.find(
    (item) => item.indexing_status !== completedDocumentIndexingStatus,
  )
  if (incompleteStatus) {
    return failFixturePrerequisite(
      world,
      `Preseeded dataset "${resourceName}" includes document ${incompleteStatus.id} with indexing status "${incompleteStatus.indexing_status ?? 'missing'}".`,
    )
  }

  if (resourceName === agentBuilderPreseededResources.agentKnowledgeBase) {
    const requiredTokens = [
      agentBuilderFixedInputs.customKnowledgeQuery,
      agentBuilderFixedInputs.knowledgeRuntimeQuery,
      agentBuilderExpectedTokens.knowledgeReply,
    ]
    const hasExpectedToken = await datasetHasEnabledSegmentContainingTokens(
      resource.id,
      resourceName,
      requiredTokens,
    )

    if (!hasExpectedToken) {
      return failFixturePrerequisite(
        world,
        `Preseeded dataset "${resourceName}" has no enabled segment containing "${requiredTokens.join('" and "')}".`,
        {
          remediation: `Seed the dataset from the Agent Builder knowledge fixture and wait until an enabled segment contains "${requiredTokens.join('" and "')}".`,
        },
      )
    }
  }

  return toDatasetResource(resource)
}
