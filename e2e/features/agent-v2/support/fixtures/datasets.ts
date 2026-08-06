import type {
  DatasetListItemResponse,
  DocumentWithSegmentsListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ConsoleClient } from '../../../../support/api/console-client'
import type { DifyWorld } from '../../../support/world'
import type { PreseededResource } from './common'
import {
  agentBuilderExpectedTokens,
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from '../agent-builder-resources'
import { failFixturePrerequisite, findResourceByName } from './common'

type DocumentIndexingStatus =
  | 'cleaning'
  | 'completed'
  | 'indexing'
  | 'parsing'
  | 'splitting'
  | 'waiting'

const completedDocumentIndexingStatus: DocumentIndexingStatus = 'completed'
const getDatasetDocuments = async (client: ConsoleClient, datasetId: string) => {
  const documents: DocumentWithSegmentsListResponse['data'] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const response = await client.datasets.byDatasetId.documents.get({
      params: { dataset_id: datasetId },
      query: { limit: '100', page: String(page) },
    })

    documents.push(...response.data)
    hasMore = response.has_more
    page += 1
  }

  return documents
}

const datasetHasEnabledSegmentContainingTokens = async (
  client: ConsoleClient,
  datasetId: string,
  expectedTokens: string[],
) => {
  const documents = await getDatasetDocuments(client, datasetId)
  for (const document of documents) {
    const response = await client.datasets.byDatasetId.documents.byDocumentId.segments.get({
      params: {
        dataset_id: datasetId,
        document_id: document.id,
      },
      query: {
        enabled: 'true',
        keyword: agentBuilderExpectedTokens.knowledgeReply,
        limit: 20,
        page: 1,
      },
    })
    const matchingSegment = response.data.find(
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
}

const toDatasetResource = (resource: DatasetListItemResponse): PreseededResource => ({
  id: resource.id,
  kind: 'dataset',
  name: resource.name,
})

export async function requireReadyPreseededDataset(
  world: DifyWorld,
  client: ConsoleClient,
  resourceName: string,
): Promise<PreseededResource> {
  const response = await client.datasets.get({
    query: { keyword: resourceName, limit: 20, page: 1 },
  })
  const resource = findResourceByName(response.data, resourceName)

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

  const indexingStatus = await client.datasets.byDatasetId.indexingStatus.get({
    params: { dataset_id: resource.id },
  })
  const statuses = indexingStatus.data
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
      client,
      resource.id,
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
