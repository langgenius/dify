import type { IndexingStatusResponse, InitialDocumentDetail } from '@/models/datasets'
import { toCreationDataSourceType } from '@/app/components/datasets/dataset-fields'
import { getNotionPageIcon } from '@/app/components/datasets/documents/document-source'

const EMBEDDING_STATUSES = ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'] as const

/**
 * Check if a status indicates the source is being embedded
 */
export const isSourceEmbedding = (detail: IndexingStatusResponse): boolean =>
  EMBEDDING_STATUSES.includes(detail.indexing_status as (typeof EMBEDDING_STATUSES)[number])

/**
 * Calculate the progress percentage for a document
 */
export const getSourcePercent = (detail: IndexingStatusResponse): number => {
  const completedCount = detail.completed_segments || 0
  const totalCount = detail.total_segments || 0

  if (totalCount === 0) return 0

  const percent = Math.round((completedCount * 100) / totalCount)
  return Math.min(percent, 100)
}

/**
 * Get file extension from filename, defaults to 'txt'
 */
export const getFileType = (name?: string): string => name?.split('.').pop() || 'txt'

/**
 * Document lookup utilities - provides document info by ID from a list
 */
export const createDocumentLookup = (documents: InitialDocumentDetail[]) => {
  const documentMap = new Map(documents.map((doc) => [doc.id, doc]))

  return {
    getDocument: (id: string) => documentMap.get(id),

    getName: (id: string) => documentMap.get(id)?.name,

    getSourceType: (id: string) => toCreationDataSourceType(documentMap.get(id)?.data_source_type),

    getNotionIcon: (id: string) => getNotionPageIcon(documentMap.get(id)?.data_source_info, false),
  }
}
