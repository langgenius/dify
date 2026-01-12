import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile as File } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'

/**
 * Build datasource info for local files
 */
export const buildLocalFileDatasourceInfo = (
  file: File,
  credentialId: string,
): Record<string, unknown> => ({
  related_id: file.id,
  name: file.name,
  type: file.type,
  size: file.size,
  extension: file.extension,
  mime_type: file.mime_type,
  url: '',
  transfer_method: TransferMethod.local_file,
  credential_id: credentialId,
})

/**
 * Build datasource info for online documents
 */
export const buildOnlineDocumentDatasourceInfo = (
  page: NotionPage & { workspace_id: string },
  credentialId: string,
): Record<string, unknown> => {
  const { workspace_id, ...rest } = page
  return {
    workspace_id,
    page: rest,
    credential_id: credentialId,
  }
}

/**
 * Build datasource info for website crawl
 */
export const buildWebsiteCrawlDatasourceInfo = (
  page: CrawlResultItem,
  credentialId: string,
): Record<string, unknown> => ({
  ...page,
  credential_id: credentialId,
})

/**
 * Build datasource info for online drive
 */
export const buildOnlineDriveDatasourceInfo = (
  file: OnlineDriveFile,
  bucket: string,
  credentialId: string,
): Record<string, unknown> => ({
  bucket,
  id: file.id,
  name: file.name,
  type: file.type,
  credential_id: credentialId,
})
