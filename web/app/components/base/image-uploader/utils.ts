import type { TFunction } from 'i18next'
import { ORPCError } from '@orpc/client'
import { uploadPublicFile } from '@/app/components/base/file-uploader/public-upload'
import { consoleClient } from '@/service/console'

/**
 * Get appropriate error message for image upload errors
 * @param error - The error object from upload failure
 * @param defaultMessage - Default error message to use if no specific error is matched
 * @param t - Translation function
 * @returns Localized error message
 */
export const getImageUploadErrorMessage = (
  error: unknown,
  defaultMessage: string,
  t: TFunction<['common']>,
): string => {
  const errorCode = error instanceof ORPCError ? error.code : undefined

  if (errorCode === 'forbidden') return error instanceof Error ? error.message : defaultMessage

  if (errorCode === 'file_extension_blocked')
    return t(($) => $['fileUploader.fileExtensionBlocked'], { ns: 'common' })

  return defaultMessage
}

type ImageUploadParams = {
  file: File
  onProgressCallback: (progress: number) => void
  onSuccessCallback: (res: { id: string }) => void
  onErrorCallback: (error?: unknown) => void
}
type ImageUpload = (v: ImageUploadParams, isPublic?: boolean) => void
export const imageUpload: ImageUpload = (
  { file, onProgressCallback, onSuccessCallback, onErrorCallback },
  isPublic,
) => {
  const onUploadProgress = ({ loaded, total }: { loaded: number; total: number }) => {
    onProgressCallback(Math.floor((loaded / total) * 100))
  }

  let uploading: Promise<{ id: string }>
  if (isPublic) {
    uploading = uploadPublicFile(file, onUploadProgress)
  } else {
    uploading = consoleClient.files.upload.post(
      { body: { file } },
      { context: { onUploadProgress } },
    )
  }

  uploading
    .then((res) => {
      onSuccessCallback(res)
    })
    .catch((error) => {
      onErrorCallback(error)
    })
}
