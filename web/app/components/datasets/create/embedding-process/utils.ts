import type {
  DataSourceInfo,
  DataSourceType,
  FullDocumentDetail,
  IndexingStatusResponse,
  LegacyDataSourceInfo,
} from '@/models/datasets'

const EMBEDDING_STATUSES = ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'] as const

/**
 * Type guard for legacy data source info with upload_file property
 */
export const isLegacyDataSourceInfo = (info: DataSourceInfo): info is LegacyDataSourceInfo => {
  return info != null && typeof (info as LegacyDataSourceInfo).upload_file === 'object'
}

/**
 * Check if a status indicates the source is being embedded
 */
export const isSourceEmbedding = (detail: IndexingStatusResponse): boolean =>
  EMBEDDING_STATUSES.includes(detail.indexing_status as typeof EMBEDDING_STATUSES[number])

/**
 * Calculate the progress percentage for a document
 */
export const getSourcePercent = (detail: IndexingStatusResponse): number => {
  const completedCount = detail.completed_segments || 0
  const totalCount = detail.total_segments || 0

  if (totalCount === 0)
    return 0

  const percent = Math.round(completedCount * 100 / totalCount)
  return Math.min(percent, 100)
}

/**
 * Get file extension from filename, defaults to 'txt'
 */
export const getFileType = (name?: string): string =>
  name?.split('.').pop() || 'txt'

/**
 * Document lookup utilities - provides document info by ID from a list
 */
export const createDocumentLookup = (documents: FullDocumentDetail[]) => {
  const documentMap = new Map(documents.map(doc => [doc.id, doc]))

  return {
    getDocument: (id: string) => documentMap.get(id),

    getName: (id: string) => documentMap.get(id)?.name,

    getSourceType: (id: string) => documentMap.get(id)?.data_source_type as DataSourceType | undefined,

    getNotionIcon: (id: string) => {
      const info = documentMap.get(id)?.data_source_info
      if (info && isLegacyDataSourceInfo(info))
        return info.notion_page_icon
      return undefined
    },
  }
}
