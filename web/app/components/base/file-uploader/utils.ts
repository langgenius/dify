import mime from 'mime'
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

export const getFileExtension = (fileName: string, fileMimetype: string) => {
  if (fileMimetype)
    return mime.getExtension(fileMimetype) || ''

  if (fileName) {
    const fileNamePair = fileName.split('.')
    const fileNamePairLength = fileNamePair.length

    if (fileNamePairLength > 1)
      return fileNamePair[fileNamePairLength - 1]
  }

  return ''
}

export const getFileAppearanceType = (fileName: string, fileMimetype: string) => {
  const extension = getFileExtension(fileName, fileMimetype)

  if (extension === 'gif')
    return FileAppearanceTypeEnum.gif

  if (FILE_EXTS.image.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.image

  if (FILE_EXTS.video.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.video

  if (FILE_EXTS.audio.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.audio

  if (extension === 'html')
    return FileAppearanceTypeEnum.code

  if (extension === 'pdf')
    return FileAppearanceTypeEnum.pdf

  if (extension === 'md' || extension === 'markdown')
    return FileAppearanceTypeEnum.markdown

  if (extension === 'xlsx' || extension === 'xls')
    return FileAppearanceTypeEnum.excel

  if (extension === 'docx' || extension === 'doc')
    return FileAppearanceTypeEnum.word

  if (extension === 'pptx' || extension === 'ppt')
    return FileAppearanceTypeEnum.ppt

  if (FILE_EXTS.document.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.document

  return FileAppearanceTypeEnum.custom
}

export const getSupportFileType = (fileName: string, fileMimetype: string, isCustom?: boolean) => {
  if (isCustom)
    return SupportUploadFileTypes.custom

  const extension = getFileExtension(fileName, fileMimetype)
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

export const getFileNameFromUrl = (url: string) => {
  const urlParts = url.split('/')
  return urlParts[urlParts.length - 1] || ''
}

export const getSupportFileExtensionList = (allowFileTypes: string[], allowFileExtensions: string[]) => {
  if (allowFileTypes.includes(SupportUploadFileTypes.custom))
    return allowFileExtensions

  return allowFileTypes.map(type => FILE_EXTS[type]).flat()
}

export const isAllowedFileExtension = (fileName: string, fileMimetype: string, allowFileTypes: string[], allowFileExtensions: string[]) => {
  return getSupportFileExtensionList(allowFileTypes, allowFileExtensions).includes(getFileExtension(fileName, fileMimetype).toUpperCase())
}
