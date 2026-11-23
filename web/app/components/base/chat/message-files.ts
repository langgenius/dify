import type { MessageFile } from '@dify/contracts/api/web/types.gen'
import type { FileResponse } from '@/types/workflow'
import { TransferMethod } from '@/types/app'

export type MessageFileInput = Partial<Omit<MessageFile, 'transfer_method'>> & {
  related_id?: string | null
  extension?: string | null
  transfer_method?: TransferMethod | string | null
  remote_url?: string | null
}

/** Preserve the message-file ID used by thought references while adapting API fields for display. */
export const toFileResponse = (file: MessageFileInput): FileResponse => ({
  related_id: file.related_id || file.id || '',
  extension: file.extension || '',
  filename: file.filename || '',
  size: file.size ?? 0,
  mime_type: file.mime_type || file.type || '',
  transfer_method: (file.transfer_method || TransferMethod.remote_url) as TransferMethod,
  type: file.type || '',
  url: file.url || '',
  upload_file_id: file.upload_file_id || '',
  remote_url: file.remote_url || file.url || '',
})
