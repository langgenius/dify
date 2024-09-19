import type { TransferMethod } from '@/types/app'

export enum FileAppearanceTypeEnum {
  image = 'image',
  video = 'video',
  audio = 'audio',
  document = 'document',
  code = 'code',
  pdf = 'pdf',
  markdown = 'markdown',
  excel = 'excel',
  word = 'word',
  ppt = 'ppt',
  gif = 'gif',
  custom = 'custom',
}

export type FileAppearanceType = keyof typeof FileAppearanceTypeEnum

export type FileEntity = {
  fileId: string
  file: File
  fileStorageId?: string
  progress: number
  url?: string
  base64Url?: string
  type: TransferMethod
  fileType: string
}
