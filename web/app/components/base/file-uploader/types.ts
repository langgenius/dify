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
  id: string
  name: string
  size: number
  type: string
  progress: number
  transferMethod: TransferMethod
  supportFileType: string
  originalFile?: File
  uploadedId?: string
  base64Url?: string
  url?: string
  isRemote?: boolean
}
