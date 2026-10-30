import type { DataSourceNotionPage } from '@/models/common'

// data_source_info is written by the data source that imported the document, so its keys are
// read defensively for each source type.
type DocumentSourceInfo = Record<string, unknown> | null | undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (record: Record<string, unknown> | undefined, key: string) => {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

const isNotionPageIcon = (
  value: unknown,
): value is NonNullable<DataSourceNotionPage['page_icon']> =>
  isRecord(value) && typeof value.type === 'string'

const toNotionIcon = (value: unknown) =>
  typeof value === 'string' || isNotionPageIcon(value) ? value : undefined

/** The file extension of a legacy uploaded-file document. */
export const getUploadFileExtension = (info: DocumentSourceInfo) =>
  isRecord(info?.upload_file) ? getString(info.upload_file, 'extension') : undefined

/** The file extension recorded by a pipeline local-file data source. */
export const getLocalFileExtension = (info: DocumentSourceInfo) =>
  getString(info ?? undefined, 'extension')

/** The file name recorded by a pipeline online-drive data source. */
export const getOnlineDriveFileName = (info: DocumentSourceInfo) =>
  getString(info ?? undefined, 'name')

/** The page icon of a Notion import, or of a pipeline online-document page. */
export const getNotionPageIcon = (info: DocumentSourceInfo, fromPipeline: boolean) => {
  if (!fromPipeline) return toNotionIcon(info?.notion_page_icon)
  return isRecord(info?.page) ? toNotionIcon(info.page.page_icon) : undefined
}
