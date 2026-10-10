import type {
  DatasetMetadataListItemResponse,
  DocumentMetadataResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'

export function createMetadataQueryWrapper({
  datasetId = 'ds-1',
  documentId = 'doc-1',
  fields = [],
  documentMetadata = [],
  builtInEnabled = false,
}: {
  datasetId?: string
  documentId?: string
  fields?: DatasetMetadataListItemResponse[]
  documentMetadata?: DocumentMetadataResponse[]
  builtInEnabled?: boolean
} = {}) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
      input: { params: { dataset_id: datasetId } },
    }),
    {
      doc_metadata: fields.map((field) => ({ ...field, count: field.count ?? 0 })),
      built_in_field_enabled: builtInEnabled,
    },
  )
  queryClient.setQueryData(consoleQuery.datasets.metadata.builtIn.get.queryKey(), {
    fields: [{ name: 'upload_date', type: 'time' }],
  })
  queryClient.setQueryData(
    consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.queryKey({
      input: {
        params: { dataset_id: datasetId, document_id: documentId },
        query: { metadata: 'only' },
      },
    }),
    { id: documentId, doc_metadata: documentMetadata },
  )
  return { queryClient, wrapper: createQueryClientWrapper(queryClient) }
}
