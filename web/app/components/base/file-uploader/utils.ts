import type { FileEntity, FilePreviewKind } from './types'
import type { FileResponse } from '@/types/workflow'
import mime from 'mime'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { consoleClient } from '@/service/console'
import { TransferMethod } from '@/types/app'
import { uploadPublicFile } from './public-upload'
import { FileAppearanceTypeEnum } from './types'

type FileUploadResponse = {
  created_at: number
  created_by: string
  extension: string
  id: string
  mime_type: string
  name: string
  preview_url: string | null
  size: number
  source_url: string
}
type FileUploadParams = {
  file: File
  onProgressCallback: (progress: number) => void
  onSuccessCallback: (res: FileUploadResponse) => void
  onErrorCallback: (error?: unknown) => void
}
type FileUpload = (v: FileUploadParams, isPublic?: boolean, trialAppId?: string) => void
export const fileUpload: FileUpload = (
  { file, onProgressCallback, onSuccessCallback, onErrorCallback },
  isPublic,
  trialAppId,
) => {
  const onUploadProgress = ({ loaded, total }: { loaded: number; total: number }) => {
    onProgressCallback(Math.floor((loaded / total) * 100))
  }
  const context = { onUploadProgress }

  let uploading: Promise<unknown>
  if (isPublic) {
    uploading = uploadPublicFile(file, onUploadProgress)
  } else if (trialAppId) {
    uploading = consoleClient.trialApps.byAppId.files.upload.post(
      { params: { app_id: trialAppId }, body: { file } },
      { context },
    )
  } else {
    uploading = consoleClient.files.upload.post({ body: { file } }, { context })
  }

  uploading
    .then((res) => {
      onSuccessCallback(res as FileUploadResponse)
    })
    .catch((error) => {
      onErrorCallback(error)
    })
}

const additionalExtensionMap = new Map<string, string[]>([['text/x-markdown', ['md']]])

export const getFileExtension = (fileName: string, fileMimetype: string, isRemote?: boolean) => {
  let extension = ''
  let extensions = new Set<string>()
  if (fileMimetype) {
    const extensionsFromMimeType = mime.getAllExtensions(fileMimetype) || new Set<string>()
    const additionalExtensions = additionalExtensionMap.get(fileMimetype) || []
    extensions = new Set<string>([...extensionsFromMimeType, ...additionalExtensions])
  }

  let extensionInFileName = ''
  if (fileName) {
    const fileNamePair = fileName.split('.')
    const fileNamePairLength = fileNamePair.length

    if (fileNamePairLength > 1) {
      extensionInFileName = fileNamePair[fileNamePairLength - 1]!.toLowerCase()
      if (extensions.has(extensionInFileName)) extension = extensionInFileName
    }
  }
  if (!extension) {
    if (extensions.size > 0) {
      const firstExtension = extensions.values().next().value
      extension = firstExtension ? firstExtension.toLowerCase() : ''
    } else {
      extension = extensionInFileName
    }
  }

  if (isRemote) extension = ''

  return extension
}

export const getFileAppearanceType = (fileName: string, fileMimetype: string) => {
  const extension = getFileExtension(fileName, fileMimetype)

  if (extension === 'gif') return FileAppearanceTypeEnum.gif

  if (FILE_EXTS.image!.includes(extension.toUpperCase())) return FileAppearanceTypeEnum.image

  if (FILE_EXTS.video!.includes(extension.toUpperCase())) return FileAppearanceTypeEnum.video

  if (FILE_EXTS.audio!.includes(extension.toUpperCase())) return FileAppearanceTypeEnum.audio

  if (extension === 'html') return FileAppearanceTypeEnum.code

  if (extension === 'pdf') return FileAppearanceTypeEnum.pdf

  if (extension === 'md' || extension === 'markdown' || extension === 'mdx')
    return FileAppearanceTypeEnum.markdown

  if (extension === 'xlsx' || extension === 'xls') return FileAppearanceTypeEnum.excel

  if (extension === 'docx' || extension === 'doc') return FileAppearanceTypeEnum.word

  if (extension === 'pptx' || extension === 'ppt') return FileAppearanceTypeEnum.ppt

  if (FILE_EXTS.document!.includes(extension.toUpperCase())) return FileAppearanceTypeEnum.document

  return FileAppearanceTypeEnum.custom
}

export const getSupportFileType = (fileName: string, fileMimetype: string, isCustom?: boolean) => {
  if (isCustom) return SupportUploadFileTypes.custom

  const extension = getFileExtension(fileName, fileMimetype)
  for (const key in FILE_EXTS) {
    if (FILE_EXTS[key]!.includes(extension.toUpperCase())) return key
  }

  return ''
}

export const getProcessedFiles = (files: FileEntity[]) => {
  return files
    .filter((file) => file.progress !== -1)
    .map((fileItem) => ({
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

      if (
        detectedTypeFromFileName &&
        detectedTypeFromMime &&
        detectedTypeFromFileName === detectedTypeFromMime &&
        detectedTypeFromFileName !== fileItem.type
      ) {
        supportFileType = detectedTypeFromFileName
      }
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
export const getSupportFileExtensionList = (
  allowFileTypes: string[],
  allowFileExtensions: string[],
) => {
  if (allowFileTypes.includes(SupportUploadFileTypes.custom))
    return allowFileExtensions.map((item) => item.slice(1).toUpperCase())

  return allowFileTypes.map((type) => FILE_EXTS[type]).flat()
}

export const isAllowedFileExtension = (
  fileName: string,
  fileMimetype: string,
  allowFileTypes: string[],
  allowFileExtensions: string[],
) => {
  return getSupportFileExtensionList(allowFileTypes, allowFileExtensions).includes(
    getFileExtension(fileName, fileMimetype).toUpperCase(),
  )
}

export const getFilesInLogs = (rawData: any) => {
  const result = Object.keys(rawData || {})
    .map((key) => {
      if (
        typeof rawData[key] === 'object' &&
        rawData[key]?.dify_model_identity === '__dify__file__'
      ) {
        return {
          varName: key,
          list: getProcessedFilesFromResponse([rawData[key]]),
        }
      }
      if (
        Array.isArray(rawData[key]) &&
        rawData[key].some((item) => item?.dify_model_identity === '__dify__file__')
      ) {
        return {
          varName: key,
          list: getProcessedFilesFromResponse(
            rawData[key].filter(
              (item: { dify_model_identity?: string } | null) =>
                item?.dify_model_identity === '__dify__file__',
            ),
          ),
        }
      }
      return undefined
    })
    .filter(Boolean)
  return result
}

export const fileIsUploaded = (file: FileEntity) => {
  if (file.uploadedId) return true

  if (file.transferMethod === TransferMethod.remote_url && file.progress === 100) return true
}

export const getFilePreviewKind = (file: FileEntity): FilePreviewKind | undefined => {
  if (!(file.url || file.base64Url || file.originalFile)) return undefined
  const [category, subtype] = file.type?.split('/') ?? []
  if (category === 'audio' || category === 'video') return category
  return subtype === 'pdf' ? 'pdf' : undefined
}

/** Add download mode without rewriting signed query values or moving it into the fragment. */
export const getFileDownloadUrl = (url: string): string => {
  const hashIndex = url.indexOf('#')
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  if (/[?&]as_attachment=/.test(base))
    return base.replace(/([?&])as_attachment=[^&]*/, '$1as_attachment=true') + hash
  const separator = base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : '?'
  return `${base}${separator}as_attachment=true${hash}`
}
