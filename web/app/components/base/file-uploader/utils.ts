import mime from 'mime'
import { FileAppearanceTypeEnum } from './types'
import type { FileEntity } from './types'
import { upload } from '@/service/base'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { FileResponse } from '@/types/workflow'
import { TransferMethod } from '@/types/app'

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

const additionalExtensionMap = new Map<string, string[]>([
  ['text/x-markdown', ['md']],
])

export const getFileExtension = (fileName: string, fileMimetype: string, isRemote?: boolean) => {
  let extension = ''
  let extensions = new Set<string>()
  if (fileMimetype) {
    const extensionsFromMimeType = mime.getAllExtensions(fileMimetype) || new Set<string>()
    const additionalExtensions = additionalExtensionMap.get(fileMimetype) || []
    extensions = new Set<string>([
      ...extensionsFromMimeType,
      ...additionalExtensions,
    ])
  }

  let extensionInFileName = ''
  if (fileName) {
    const fileNamePair = fileName.split('.')
    const fileNamePairLength = fileNamePair.length

    if (fileNamePairLength > 1) {
      extensionInFileName = fileNamePair[fileNamePairLength - 1].toLowerCase()
      if (extensions.has(extensionInFileName))
        extension = extensionInFileName
    }
  }
  if (!extension) {
    if (extensions.size > 0) {
      const firstExtension = extensions.values().next().value
      extension = firstExtension ? firstExtension.toLowerCase() : ''
    }
    else {
      extension = extensionInFileName
    }
  }

  if (isRemote)
    extension = ''

  return extension
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

  if (extension === 'md' || extension === 'markdown' || extension === 'mdx')
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

export const getProcessedFilesFromResponse = (files: FileResponse[]) => {
  return files.map((fileItem) => {
    let supportFileType = fileItem.type

    if (fileItem.filename && fileItem.mime_type) {
      const detectedTypeFromFileName = getSupportFileType(fileItem.filename, '')
      const detectedTypeFromMime = getSupportFileType('', fileItem.mime_type)

      if (detectedTypeFromFileName
          && detectedTypeFromMime
          && detectedTypeFromFileName === detectedTypeFromMime
          && detectedTypeFromFileName !== fileItem.type)
        supportFileType = detectedTypeFromFileName
    }

    return {
      id: fileItem.related_id,
      name: fileItem.filename,
      size: fileItem.size || 0,
      type: fileItem.mime_type,
      progress: 100,
      transferMethod: fileItem.transfer_method,
      supportFileType,
      uploadedId: fileItem.upload_file_id || fileItem.related_id,
      url: fileItem.url || fileItem.remote_url,
    }
  })
}

export const getFileNameFromUrl = (url: string) => {
  const urlParts = url.split('/')
  return urlParts[urlParts.length - 1] || ''
}

export const getSupportFileExtensionList = (allowFileTypes: string[], allowFileExtensions: string[]) => {
  if (allowFileTypes.includes(SupportUploadFileTypes.custom))
    return allowFileExtensions.map(item => item.slice(1).toUpperCase())

  return allowFileTypes.map(type => FILE_EXTS[type]).flat()
}

export const isAllowedFileExtension = (fileName: string, fileMimetype: string, allowFileTypes: string[], allowFileExtensions: string[]) => {
  return getSupportFileExtensionList(allowFileTypes, allowFileExtensions).includes(getFileExtension(fileName, fileMimetype).toUpperCase())
}

export const getFilesInLogs = (rawData: any) => {
  const result = Object.keys(rawData || {}).map((key) => {
    if (typeof rawData[key] === 'object' && rawData[key]?.dify_model_identity === '__dify__file__') {
      return {
        varName: key,
        list: getProcessedFilesFromResponse([rawData[key]]),
      }
    }
    if (Array.isArray(rawData[key]) && rawData[key].some(item => item?.dify_model_identity === '__dify__file__')) {
      return {
        varName: key,
        list: getProcessedFilesFromResponse(rawData[key]),
      }
    }
    return undefined
  }).filter(Boolean)
  return result
}

export const fileIsUploaded = (file: FileEntity) => {
  if (file.uploadedId)
    return true

  if (file.transferMethod === TransferMethod.remote_url && file.progress === 100)
    return true
}

export const downloadFile = (url: string, filename: string) => {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  anchor.target = '_blank'
  anchor.title = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}
