import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { useMemo } from 'react'
import { DataSourceType } from '@/models/datasets'

type LocalDoc = DocumentWithSegmentsResponse & { percent?: number }

type UseDocumentSelectionOptions = {
  selectedDocuments: LocalDoc[]
}

export const useDocumentSelection = ({ selectedDocuments }: UseDocumentSelectionOptions) => {
  const hasRecoverableDocumentsSelected = useMemo(
    () => selectedDocuments.some(({ indexing_retry_action }) => indexing_retry_action != null),
    [selectedDocuments],
  )

  const downloadableSelectedIds = useMemo(() => {
    return selectedDocuments
      .filter((doc) => doc.data_source_type === DataSourceType.FILE)
      .map((doc) => doc.id)
  }, [selectedDocuments])

  return {
    hasRecoverableDocumentsSelected,
    downloadableSelectedIds,
  }
}
