import { consoleClient } from '@/service/client'

type KnowledgeFsUploadItem = {
  file: File
  id: string
}

type UploadProgressEntry = {
  phase: KnowledgeFsUploadPhase
}

export type KnowledgeFsUploadPhase = 'completed' | 'pending'
export type KnowledgeFsUploadProgress = Map<string, UploadProgressEntry>

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
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.post({
      body: { file: upload.file },
      params: { control_space_id: controlSpaceId },
    })
    progress.set(upload.id, { phase: 'completed' })
    onProgress?.(upload.file, 'completed')
  }
}
