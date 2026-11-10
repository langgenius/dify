import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { TransferMethod } from '@/types/app'

export const FILE_FIELD_TYPES = new Set(['file', 'file-list', 'files'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toFileEntity = (value: unknown): FileEntity | null => {
  if (!isRecord(value)) return null

  if (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string' &&
    typeof value.progress === 'number' &&
    typeof value.transferMethod === 'string' &&
    typeof value.supportFileType === 'string'
  ) {
    return value as FileEntity
  }

  const uploadedId =
    typeof value.uploadedId === 'string'
      ? value.uploadedId
      : typeof value.upload_file_id === 'string'
        ? value.upload_file_id
        : ''
  const url = typeof value.url === 'string' ? value.url : ''
  if (!uploadedId && !url) return null

  const transferMethod =
    value.transfer_method === TransferMethod.remote_url
      ? TransferMethod.remote_url
      : TransferMethod.local_file
  const supportFileType = typeof value.type === 'string' ? value.type : ''
  const id =
    typeof value.id === 'string'
      ? value.id
      : typeof value.related_id === 'string'
        ? value.related_id
        : uploadedId || url

  return {
    id,
    name:
      typeof value.name === 'string'
        ? value.name
        : typeof value.filename === 'string'
          ? value.filename
          : uploadedId || url,
    size: typeof value.size === 'number' ? value.size : 0,
    type: typeof value.mime_type === 'string' ? value.mime_type : supportFileType,
    progress: 100,
    transferMethod,
    supportFileType,
    uploadedId: uploadedId || undefined,
    url: url || undefined,
    isRemote: transferMethod === TransferMethod.remote_url,
  }
}

export const toFileEntities = (value: unknown): FileEntity[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  return values.map(toFileEntity).filter((file): file is FileEntity => file !== null)
}
