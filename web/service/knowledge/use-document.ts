import type { MutationMeta } from '@tanstack/react-query'
import type { DocumentDownloadZipRequest } from '../datasets'
import { useMutation } from '@tanstack/react-query'
import { downloadDocumentsZip } from '../datasets'

export const useDocumentDownloadZip = (options?: { meta?: MutationMeta }) => {
  return useMutation({
    meta: options?.meta,
    mutationFn: ({ datasetId, documentIds }: DocumentDownloadZipRequest) => {
      if (!datasetId || !documentIds?.length)
        throw new Error('datasetId and documentIds are required')
      return downloadDocumentsZip({ datasetId, documentIds })
    },
  })
}
