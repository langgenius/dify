import type { TransferMethod } from '@/types/app'

export enum FileTypeEnum {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
  CODE = 'CODE',
  PDF = 'PDF',
  MARKDOWN = 'MARKDOWN',
  EXCEL = 'EXCEL',
  WORD = 'WORD',
  PPT = 'PPT',
  GIF = 'GIF',
  OTHER = 'OTHER',
}

export type FileEntity = {
  file: File
  _id: string
  _fileId?: string
  _progress?: number
  _url?: string
  _base64Url?: string
  _method?: TransferMethod
}
