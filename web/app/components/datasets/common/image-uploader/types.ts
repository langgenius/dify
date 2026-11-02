export type FileEntity = {
  id: string
  name: string
  size: number
  extension: string
  mimeType: string
  progress: number // -1: error, 0 ~ 99: uploading, 100: uploaded
  originalFile?: File // used for re-uploading
  uploadedId?: string // for uploaded image id
  sourceUrl?: string // for uploaded image
  base64Url?: string // for image preview during uploading
}

export type FileUploadConfig = {
  imageFileSizeLimit: number
  imageFileBatchLimit: number
  singleChunkAttachmentLimit: number
}
