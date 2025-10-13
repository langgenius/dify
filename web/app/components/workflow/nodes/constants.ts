import { TransferMethod } from '@/types/app'

export const FILE_TYPE_OPTIONS = [
  { value: 'image', i18nKey: 'image' },
  { value: 'document', i18nKey: 'doc' },
  { value: 'audio', i18nKey: 'audio' },
  { value: 'video', i18nKey: 'video' },
]

export const TRANSFER_METHOD = [
  { value: TransferMethod.local_file, i18nKey: 'localUpload' },
  { value: TransferMethod.remote_url, i18nKey: 'url' },
]

export const SUB_VARIABLES = ['type', 'size', 'name', 'url', 'extension', 'mime_type', 'transfer_method', 'related_id']
export const OUTPUT_FILE_SUB_VARIABLES = SUB_VARIABLES.filter(key => key !== 'transfer_method')
