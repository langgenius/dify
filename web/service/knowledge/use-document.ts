import type { DocumentDownloadZipRequest } from '../datasets'
import { useMutation } from '@tanstack/react-query'
import { downloadDocumentsZip } from '../datasets'

export const useDocumentDownloadZip = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds }: DocumentDownloadZipRequest) => {
      if (!datasetId || !documentIds?.length)
        throw new Error('datasetId and documentIds are required')
      return downloadDocumentsZip({ datasetId, documentIds })
    },
  })
}
