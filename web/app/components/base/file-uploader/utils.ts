import { FileAppearanceTypeEnum } from './types'
import type { FileEntity } from './types'
import { upload } from '@/service/base'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'

type FileUploadParams = {
  file: File
  onProgressCallback: (progress: number) => void
  onSuccessCallback: (res: { id: string }) => void
  onErrorCallback: () => void
}
type FileUpload = (v: FileUploadParams, isPublic?: boolean, url?: string) => void
export const fileUpload: FileUpload = ({
  file,
  onProgressCallback,
  onSuccessCallback,
  onErrorCallback,
}, isPublic, url) => {
  const formData = new FormData()
  formData.append('file', file)
  const onProgress = (e: ProgressEvent) => {
    if (e.lengthComputable) {
      const percent = Math.floor(e.loaded / e.total * 100)
      onProgressCallback(percent)
    }
  }

  upload({
    xhr: new XMLHttpRequest(),
    data: formData,
    onprogress: onProgress,
  }, isPublic, url)
    .then((res: { id: string }) => {
      onSuccessCallback(res)
    })
    .catch(() => {
      onErrorCallback()
    })
}

export const getFileAppearanceType = (fileType: string) => {
  if (!fileType)
    return FileAppearanceTypeEnum.custom

  if (fileType.includes('image'))
    return FileAppearanceTypeEnum.image

  if (fileType.includes('video'))
    return FileAppearanceTypeEnum.video

  if (fileType.includes('audio'))
    return FileAppearanceTypeEnum.audio

  if (fileType.includes('pdf'))
    return FileAppearanceTypeEnum.pdf

  return FileAppearanceTypeEnum.custom
}

export const getFileExtension = (fileName: string) => {
  if (!fileName)
    return ''

  const fileNamePair = fileName.split('.')
  const fileNamePairLength = fileNamePair.length

  if (fileNamePairLength > 1)
    return fileNamePair[fileNamePairLength - 1]

  return ''
}

export const getSupportFileType = (fileName: string, isCustom?: boolean) => {
  if (isCustom)
    return SupportUploadFileTypes.custom

  const extension = getFileExtension(fileName)
  for (const key in FILE_EXTS) {
    if ((FILE_EXTS[key]).includes(extension.toUpperCase()))
      return key
  }

  return ''
}

export const getProcessedFiles = (files: FileEntity[]) => {
  return files.filter(file => file.progress !== -1).map(fileItem => ({
    type: fileItem.supportFileType,
    transfer_method: fileItem.transferMethod,
    url: fileItem.url || '',
    upload_file_id: fileItem.uploadedId || '',
  }))
}
