import type { MessageFile } from '@dify/contracts/api/web/types.gen'
import type { TransferMethod } from '@/types/app'
import type { FileResponse } from '@/types/workflow'

/** Preserve the message-file ID used by thought references while adapting API fields for display. */
export const toFileResponse = (file: MessageFile): FileResponse => ({
  related_id: file.id,
  extension: '',
  filename: file.filename,
  size: file.size ?? 0,
  mime_type: file.mime_type ?? '',
  transfer_method: file.transfer_method as TransferMethod,
  type: file.type,
  url: file.url ?? '',
  upload_file_id: file.upload_file_id ?? '',
  remote_url: file.url ?? '',
})
