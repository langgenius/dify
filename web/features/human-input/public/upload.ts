import type { HumanInputV2FormTransport } from './types'
import type { FileUploadStrategy } from '@/app/components/base/file-uploader/upload-context'

type UploadCallbacks = Omit<Parameters<FileUploadStrategy['uploadLocal']>[0], 'file'>

const uploadHumanInputV2LocalFile = async ({
  transport,
  formToken,
  file,
  onProgressCallback,
  onSuccessCallback,
  onErrorCallback,
}: UploadCallbacks & {
  transport: HumanInputV2FormTransport
  formToken: string
  file: File
}) => {
  try {
    onProgressCallback(20)
    const uploadedFile = await transport.uploadLocalFile(formToken, file)
    onProgressCallback(100)
    onSuccessCallback({
      created_at: Math.floor(Date.now() / 1000),
      created_by: 'human-input-v2-form',
      extension: uploadedFile.name.includes('.') ? uploadedFile.name.split('.').pop()! : '',
      id: uploadedFile.id,
      name: uploadedFile.name,
      mime_type: uploadedFile.mimeType,
      preview_url: null,
      size: uploadedFile.size,
      source_url: uploadedFile.url,
    })
  } catch (error) {
    onErrorCallback(error)
  }
}

const uploadHumanInputV2RemoteFile = async ({
  transport,
  formToken,
  url,
}: {
  transport: HumanInputV2FormTransport
  formToken: string
  url: string
}) => {
  const uploadedFile = await transport.uploadRemoteFile(formToken, url)
  return {
    id: uploadedFile.id,
    name: uploadedFile.name,
    mime_type: uploadedFile.mimeType,
    size: uploadedFile.size,
    url: uploadedFile.url,
  }
}

export const createHumanInputV2UploadStrategy = (
  formToken: string,
  transport: HumanInputV2FormTransport,
): FileUploadStrategy => ({
  uploadLocal: (params) => {
    void uploadHumanInputV2LocalFile({ transport, formToken, ...params })
  },
  uploadRemote: (url) => uploadHumanInputV2RemoteFile({ transport, formToken, url }),
})
