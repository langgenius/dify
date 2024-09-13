export enum FileAppearanceTypeEnum {
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

export type FileAppearanceType = keyof typeof FileAppearanceTypeEnum

export type FileEntity = {
  fileId: string
  file: File
  fileStorageId?: string
  progress: number
  url?: string
  base64Url?: string
}
