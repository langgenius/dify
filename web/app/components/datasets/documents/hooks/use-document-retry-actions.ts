import type { DocumentResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/console'

export type DocumentIndexingRetryAction = NonNullable<DocumentResponse['indexing_retry_action']>

export type DocumentRetryTarget = {
  id: string
  action: DocumentIndexingRetryAction
}

export const useDocumentRetryActions = (datasetId: string) => {
  const documents = consoleQuery.datasets.byDatasetId.documents
  const { mutateAsync: retry, isPending: isRetryPending } = useMutation(
    consoleQuery.datasets.byDatasetId.retry.post.mutationOptions(),
  )
  const { mutateAsync: changeStatus, isPending: isStatusPending } = useMutation(
    documents.status.byAction.batch.patch.mutationOptions(),
  )

  const retryDocuments = useCallback(
    async (targets: DocumentRetryTarget[]) => {
      const targetIdsByAction = new Map<DocumentIndexingRetryAction, string[]>()
      for (const { id, action } of targets) {
        const documentIds = targetIdsByAction.get(action) ?? []
        documentIds.push(id)
        targetIdsByAction.set(action, documentIds)
      }

      await Promise.all(
        Array.from(targetIdsByAction, ([action, documentIds]) => {
          if (action === 'retry') {
            return retry({
              params: { dataset_id: datasetId },
              body: { document_ids: documentIds },
            })
          }

          return changeStatus({
            params: { dataset_id: datasetId, action },
            query: { document_id: documentIds },
          })
        }),
      )
    },
    [changeStatus, datasetId, retry],
  )

  return {
    retryDocuments,
    isPending: isRetryPending || isStatusPending,
  }
}
