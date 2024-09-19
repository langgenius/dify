import { FileAppearanceTypeEnum } from './types'
import { upload } from '@/service/base'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'

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

export const getFileAppearanceType = (file?: File) => {
  if (!file)
    return FileAppearanceTypeEnum.custom
  const mimeType = file.type

  if (mimeType.includes('image'))
    return FileAppearanceTypeEnum.image

  if (mimeType.includes('video'))
    return FileAppearanceTypeEnum.video

  if (mimeType.includes('audio'))
    return FileAppearanceTypeEnum.audio

  if (mimeType.includes('pdf'))
    return FileAppearanceTypeEnum.pdf

  return FileAppearanceTypeEnum.custom
}

export const isImage = (file?: File) => {
  return file?.type.startsWith('image')
}

export const getFileExtension = (file?: File) => {
  if (!file)
    return ''

  const fileNamePair = file.name.split('.')
  const fileNamePairLength = fileNamePair.length

  if (fileNamePairLength > 1)
    return fileNamePair[fileNamePairLength - 1]

  return ''
}

export const getFileType = (file?: File) => {
  const extension = getFileExtension(file)
  for (const key in FILE_EXTS) {
    if ((FILE_EXTS[key]).includes(extension.toUpperCase()))
      return key
  }

  return ''
}
