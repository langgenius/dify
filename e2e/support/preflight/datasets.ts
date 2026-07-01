import type { DifyWorld } from '../../features/support/world'
import type { NamedResource, PreseededResource } from './common'
import { createApiContext, expectApiResponseOK } from '../api'
import {
  buildQuery,
  findConsoleResourceByName,

  skipBlockedPrecondition,
} from './common'

type DatasetResource = NamedResource & {
  document_count: number
  total_available_documents: number
}

type DocumentIndexingStatus
  = | 'cleaning'
    | 'completed'
    | 'indexing'
    | 'parsing'
    | 'splitting'
    | 'waiting'

type DatasetIndexingStatusResponse = {
  data: Array<{
    id: string
    indexing_status?: string
  }>
}

const completedDocumentIndexingStatus: DocumentIndexingStatus = 'completed'
const activeDocumentIndexingStatuses = new Set<string>([
  'cleaning',
  'indexing',
  'parsing',
  'splitting',
  'waiting',
])

export const getPreseededDataset = async (resourceName: string) => {
  const query = buildQuery({ keyword: resourceName, limit: '20', page: '1' })

  return findConsoleResourceByName<DatasetResource>({
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
    const body = (await response.json()) as DatasetIndexingStatusResponse

    return body.data
  }
  finally {
    await ctx.dispose()
  }
}

export const toDatasetResource = (
  resource: NamedResource,
): PreseededResource => ({
  id: resource.id,
  kind: 'dataset',
  name: resource.name,
})

export async function skipMissingPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | PreseededResource> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  return toDatasetResource(resource)
}

export async function skipMissingReadyPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | PreseededResource> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  if (resource.document_count < 1) {
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" has no documents.`)
  }

  if (resource.total_available_documents !== resource.document_count) {
    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" has ${resource.total_available_documents}/${resource.document_count} available documents.`,
    )
  }

  const statuses = await getDatasetIndexingStatuses(resource.id, resourceName)
  if (statuses.length < 1) {
    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" has no document indexing status.`,
    )
  }

  const incompleteStatus = statuses.find(
    item => item.indexing_status !== completedDocumentIndexingStatus,
  )
  if (incompleteStatus) {
    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" includes document ${incompleteStatus.id} with indexing status "${incompleteStatus.indexing_status ?? 'missing'}".`,
    )
  }

  return toDatasetResource(resource)
}

export async function skipMissingIndexingPreseededDataset(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | PreseededResource> {
  const resource = await getPreseededDataset(resourceName)

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded dataset "${resourceName}" was not found.`)

  const statuses = await getDatasetIndexingStatuses(resource.id, resourceName)
  const indexingStatus = statuses.find(item =>
    activeDocumentIndexingStatuses.has(item.indexing_status ?? ''),
  )

  if (!indexingStatus) {
    const actualStatuses
      = statuses.map(item => item.indexing_status ?? 'missing').join(', ') || 'none'

    return skipBlockedPrecondition(
      world,
      `Preseeded dataset "${resourceName}" is not indexing or queued; document statuses: ${actualStatuses}.`,
    )
  }

  return toDatasetResource(resource)
}
