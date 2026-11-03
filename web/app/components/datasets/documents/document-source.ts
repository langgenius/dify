import { DataSourceType } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'

type DocumentSourceInfo = Record<string, unknown> | null | undefined

/** Whether the source contains a file reference supported by document downloads. */
export const isDownloadableFileDocument = (
  sourceType: string | null | undefined,
  info: DocumentSourceInfo,
) => {
  if (sourceType === DataSourceType.FILE)
    return true
  if (sourceType !== DatasourceType.localFile)
    return false

  return ['real_file_id', 'related_id', 'reference'].some((key) => {
    const value = info?.[key]
    return typeof value === 'string' && value.length > 0
  })
}
