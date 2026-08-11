import { consoleClient } from '@/service/client'

export type KnowledgeFsUploadItem = {
  file: File
  id: string
  uploadId: string
}

type UploadProgressEntry = {
  phase: KnowledgeFsUploadPhase
}

export type KnowledgeFsUploadPhase = 'completed' | 'pending'
export type KnowledgeFsUploadProgress = Map<string, UploadProgressEntry>

export async function stageKnowledgeFsDocument(file: File, signal?: AbortSignal) {
  const staged = await consoleClient.knowledgeFs.uploads.post(
    {
      body: { file },
    },
    { context: { silent: true }, signal },
  )
  return staged.id
}

export async function discardKnowledgeFsStagedUpload(uploadId: string) {
  await consoleClient.knowledgeFs.uploads.byUploadId.delete({
    params: { upload_id: uploadId },
  })
}

export async function uploadKnowledgeFsDocuments(
  controlSpaceId: string,
  uploads: KnowledgeFsUploadItem[],
  progress: KnowledgeFsUploadProgress = new Map(),
  onProgress?: (file: File, phase: KnowledgeFsUploadPhase) => void,
) {
  for (const upload of uploads) {
    if (progress.get(upload.id)?.phase === 'completed') continue
    progress.set(upload.id, { phase: 'pending' })
    onProgress?.(upload.file, 'pending')
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.post(
      {
        body: { upload_id: upload.uploadId },
        params: { control_space_id: controlSpaceId },
      },
      { context: { silent: true } },
    )
    progress.set(upload.id, { phase: 'completed' })
    onProgress?.(upload.file, 'completed')
  }
}
