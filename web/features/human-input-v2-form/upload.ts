import type { HumanInputV2FormTransport } from './types'

type UploadCallbacks = {
  onProgressCallback: (progress: number) => void
  onSuccessCallback: (response: {
    created_at: number
    created_by: string
    extension: string
    id: string
    name: string
    mime_type: string
    preview_url: string | null
    size: number
    source_url: string
  }) => void
  onErrorCallback: (error?: unknown) => void
}

export const uploadHumanInputV2LocalFile = async ({
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
    await transport.requestUploadToken(formToken)
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

export const uploadHumanInputV2RemoteFile = async ({
  transport,
  formToken,
  url,
}: {
  transport: HumanInputV2FormTransport
  formToken: string
  url: string
}) => {
  await transport.requestUploadToken(formToken)
  const uploadedFile = await transport.uploadRemoteFile(formToken, url)
  return {
    id: uploadedFile.id,
    name: uploadedFile.name,
    mime_type: uploadedFile.mimeType,
    size: uploadedFile.size,
    url: uploadedFile.url,
  }
}
