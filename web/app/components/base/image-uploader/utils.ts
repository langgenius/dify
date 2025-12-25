import { upload } from '@/service/base'

/**
 * Get appropriate error message for image upload errors
 * @param error - The error object from upload failure
 * @param defaultMessage - Default error message to use if no specific error is matched
 * @param t - Translation function
 * @returns Localized error message
 */
export const getImageUploadErrorMessage = (error: any, defaultMessage: string, t: (key: string) => string): string => {
  const errorCode = error?.response?.code

  if (errorCode === 'forbidden')
    return error?.response?.message

  if (errorCode === 'file_extension_blocked')
    return t('common.fileUploader.fileExtensionBlocked')

  return defaultMessage
}

type ImageUploadParams = {
  file: File
  onProgressCallback: (progress: number) => void
  onSuccessCallback: (res: { id: string }) => void
  onErrorCallback: (error?: any) => void
}
type ImageUpload = (v: ImageUploadParams, isPublic?: boolean, url?: string) => void
export const imageUpload: ImageUpload = ({
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
    .catch((error) => {
      onErrorCallback(error)
    })
}
