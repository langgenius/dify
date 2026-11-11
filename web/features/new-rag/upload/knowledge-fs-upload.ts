import type { FileScanFailure } from '@/features/file-scan/scan-failure'
import { FILE_SCAN_PENDING_CODE, fileScanFailureFromError } from '@/features/file-scan/scan-failure'
import { consoleClient } from '@/service/console'

export type KnowledgeFsUploadItem = {
  file: File
  id: string
  uploadId: string
}

type UploadProgressEntry = {
  /** Set while `phase` is `failed`. */
  failure?: FileScanFailure
  phase: KnowledgeFsUploadPhase
}

/**
 * `scanning` means the malware scanner has not answered yet and the claim is being repeated.
 * `failed` means the malware scan rejected the file; every other error still aborts the batch.
 */
export type KnowledgeFsUploadPhase = 'completed' | 'failed' | 'pending' | 'scanning'
export type KnowledgeFsUploadProgress = Map<string, UploadProgressEntry>

type KnowledgeFsUploadFailure = {
  failure: FileScanFailure
  upload: KnowledgeFsUploadItem
}

type KnowledgeFsUploadResult = {
  /** Files the malware scan rejected, in upload order. */
  failures: KnowledgeFsUploadFailure[]
}

const SCAN_PENDING_RETRY_DELAY_MS = 3_000
const SCAN_PENDING_MAX_RETRIES = 40

/** A settled upload needs no further claim: it either succeeded or was rejected for good. */
export function isKnowledgeFsUploadSettled(progress: KnowledgeFsUploadProgress, id: string) {
  const entry = progress.get(id)
  return entry?.phase === 'completed' || (entry?.phase === 'failed' && !entry.failure?.retryable)
}

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
  await consoleClient.knowledgeFs.uploads.byUploadId.delete(
    { params: { upload_id: uploadId } },
    { context: { silent: true } },
  )
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Claims one staged upload. Resolves with the scan rejection when there is one and rethrows
 * every other error. While the scanner is still working the same claim is repeated.
 */
async function claimKnowledgeFsDocument(
  controlSpaceId: string,
  upload: KnowledgeFsUploadItem,
  onScanning: () => void,
): Promise<FileScanFailure | undefined> {
  for (let retries = 0; ; retries++) {
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.post(
        {
          body: { upload_id: upload.uploadId },
          params: { control_space_id: controlSpaceId },
        },
        { context: { silent: true } },
      )
      return undefined
    } catch (error) {
      const failure = fileScanFailureFromError(error, upload.file.name)
      if (!failure) throw error
      if (failure.code !== FILE_SCAN_PENDING_CODE) return failure
      // The scan may still finish later, so the file stays retryable after the wait runs out.
      if (retries >= SCAN_PENDING_MAX_RETRIES) return { ...failure, retryable: true }
      onScanning()
      await wait(SCAN_PENDING_RETRY_DELAY_MS)
    }
  }
}

export async function uploadKnowledgeFsDocuments(
  controlSpaceId: string,
  uploads: KnowledgeFsUploadItem[],
  progress: KnowledgeFsUploadProgress = new Map(),
  onProgress?: (file: File, phase: KnowledgeFsUploadPhase) => void,
): Promise<KnowledgeFsUploadResult> {
  const failures: KnowledgeFsUploadFailure[] = []
  for (const upload of uploads) {
    const previous = progress.get(upload.id)
    if (previous?.phase === 'completed') continue
    // The backend deletes a rejected file, so only a retryable rejection is claimed again.
    if (previous?.phase === 'failed' && previous.failure && !previous.failure.retryable) {
      failures.push({ failure: previous.failure, upload })
      continue
    }
    progress.set(upload.id, { phase: 'pending' })
    onProgress?.(upload.file, 'pending')
    const failure = await claimKnowledgeFsDocument(controlSpaceId, upload, () => {
      progress.set(upload.id, { phase: 'scanning' })
      onProgress?.(upload.file, 'scanning')
    })
    if (failure) {
      // A scan rejection concerns this file only; the remaining files are still claimed.
      progress.set(upload.id, { failure, phase: 'failed' })
      onProgress?.(upload.file, 'failed')
      failures.push({ failure, upload })
      continue
    }
    progress.set(upload.id, { phase: 'completed' })
    onProgress?.(upload.file, 'completed')
  }
  return { failures }
}
