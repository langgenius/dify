import { consoleQuery } from '@/service/console'

export function documentRenameKey(datasetId: string, documentId: string) {
  return [
    ...consoleQuery.datasets.byDatasetId.documents.byDocumentId.rename.post.mutationKey(),
    datasetId,
    documentId,
  ]
}
