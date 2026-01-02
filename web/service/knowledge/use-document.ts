import type { MetadataType, SortType } from '../datasets'
import type { CommonResponse } from '@/models/common'
import type { DocumentDetailResponse, DocumentListResponse, UpdateDocumentBatchParams } from '@/models/datasets'
import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { normalizeStatusForQuery } from '@/app/components/datasets/documents/status-filter'
import { DocumentActionType } from '@/models/datasets'
import {
  deleteDocumentBatch,
  fetchAutoDisabledDocuments,
  fetchDocumentDetail,
  fetchDocumentList,
  pauseDocIndexing,
  resumeDocIndexing,
  retryDocumentBatch,
  syncNotionDocument,
  syncWebsiteDocument,
  updateDocumentStatusBatch,
} from '../datasets'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'knowledge/document'

export const useDocumentListKey = [NAME_SPACE, 'documentList']
export const useDocumentList = (payload: {
  datasetId: string
  query: {
    keyword: string
    page: number
    limit: number
    sort?: SortType
    status?: string
  }
  refetchInterval?: number | false
}) => {
  const { query, datasetId, refetchInterval } = payload
  const { keyword, page, limit, sort, status } = query
  const normalizedStatus = normalizeStatusForQuery(status)
  const params: { keyword: string, page: number, limit: number, sort?: SortType, status?: string } = {
    keyword,
    page,
    limit,
  }
  if (sort)
    params.sort = sort
  if (normalizedStatus && normalizedStatus !== 'all')
    params.status = normalizedStatus
  return useQuery<DocumentListResponse>({
    queryKey: [...useDocumentListKey, datasetId, keyword, page, limit, sort, normalizedStatus],
    queryFn: () => fetchDocumentList(datasetId, params),
    refetchInterval,
  })
}

export const useInvalidDocumentList = (datasetId?: string) => {
  return useInvalid(datasetId ? [...useDocumentListKey, datasetId] : useDocumentListKey)
}

const useAutoDisabledDocumentKey = [NAME_SPACE, 'autoDisabledDocument']
export const useAutoDisabledDocuments = (datasetId: string) => {
  return useQuery({
    queryKey: [...useAutoDisabledDocumentKey, datasetId],
    queryFn: () => fetchAutoDisabledDocuments(datasetId),
  })
}

export const useInvalidDisabledDocument = () => {
  return useInvalid(useAutoDisabledDocumentKey)
}

export const useDocumentBatchAction = (action: DocumentActionType) => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return updateDocumentStatusBatch(datasetId, action, documentId || documentIds!)
    },
  })
}

export const useDocumentEnable = () => {
  return useDocumentBatchAction(DocumentActionType.enable)
}

export const useDocumentDisable = () => {
  return useDocumentBatchAction(DocumentActionType.disable)
}

export const useDocumentArchive = () => {
  return useDocumentBatchAction(DocumentActionType.archive)
}

export const useDocumentUnArchive = () => {
  return useDocumentBatchAction(DocumentActionType.unArchive)
}

export const useDocumentDelete = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return deleteDocumentBatch(datasetId, documentId || documentIds!)
    },
  })
}

export const useSyncDocument = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      return syncNotionDocument(datasetId, documentId as string)
    },
  })
}

export const useSyncWebsite = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      return syncWebsiteDocument(datasetId, documentId as string)
    },
  })
}

const useDocumentDetailKey = [NAME_SPACE, 'documentDetail', 'withoutMetaData']
export const useDocumentDetail = (payload: {
  datasetId: string
  documentId: string
  params: { metadata: MetadataType }
}) => {
  const { datasetId, documentId, params } = payload
  return useQuery<DocumentDetailResponse>({
    queryKey: [...useDocumentDetailKey, 'withoutMetaData', datasetId, documentId],
    queryFn: () => fetchDocumentDetail(datasetId, documentId, params),
  })
}

export const useDocumentMetadata = (payload: {
  datasetId: string
  documentId: string
  params: { metadata: MetadataType }
}) => {
  const { datasetId, documentId, params } = payload
  return useQuery<DocumentDetailResponse>({
    queryKey: [...useDocumentDetailKey, 'onlyMetaData', datasetId, documentId],
    queryFn: () => fetchDocumentDetail(datasetId, documentId, params),
  })
}

export const useInvalidDocumentDetail = () => {
  return useInvalid(useDocumentDetailKey)
}

export const useDocumentPause = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId)
        throw new Error('datasetId and documentId are required')
      return pauseDocIndexing({ datasetId, documentId }) as Promise<CommonResponse>
    },
  })
}

export const useDocumentResume = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId)
        throw new Error('datasetId and documentId are required')
      return resumeDocIndexing({ datasetId, documentId }) as Promise<CommonResponse>
    },
  })
}

export const useDocumentBatchRetryIndex = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds }: { datasetId: string, documentIds: string[] }) => {
      return retryDocumentBatch(datasetId, documentIds)
    },
  })
}
