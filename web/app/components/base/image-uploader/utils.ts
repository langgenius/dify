import { uploadPublicFile } from '@/app/components/base/file-uploader/public-upload'
import { consoleClient } from '@/service/console'

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
