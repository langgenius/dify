import type { KnowledgeFsCapabilityResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { consoleClient } from '@/service/client'
import { createRequestId } from './request-id'

type UploadSession = {
  id: string
  mode: 'multipart' | 'single' | 'small_fallback'
  multipartPartCount?: number
  multipartPartSizeBytes?: number
  status:
    | 'creating'
    | 'ready'
    | 'completing'
    | 'completed'
    | 'aborting'
    | 'aborted'
    | 'expired'
    | 'failed'
}

type PresignedUpload = {
  headers: Record<string, string>
  method: 'PUT'
  url: string
}

type CreateUploadSessionResponse = {
  session: UploadSession
  upload?: PresignedUpload
}

type PresignedPart = PresignedUpload

type CompletedPart = {
  checksumSha256Base64: string
  etag: string
  partNumber: number
}

type UploadCompletion =
  | {
      mode: 'small_fallback'
      sessionId: string
    }
  | {
      mode: 'single'
      sessionId: string
    }
  | {
      mode: 'multipart'
      parts: CompletedPart[]
      sessionId: string
    }

type UploadProgressEntry =
  | {
      idempotencyKey: string
      phase: 'pending'
    }
  | {
      completion: UploadCompletion
      idempotencyKey: string
      phase: 'completing'
    }
  | {
      idempotencyKey: string
      phase: 'completed'
    }

type KnowledgeFsUploadItem = {
  file: File
  id: string
}

export type KnowledgeFsUploadProgress = Map<string, UploadProgressEntry>

const SPACE_READY_POLL_INTERVAL_MS = 500
const SPACE_READY_TIMEOUT_MS = 60_000

function directUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/, '')}${path}`
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`KnowledgeFS upload request failed with ${response.status}`)
  return response.json() as Promise<T>
}

async function capability(
  controlSpaceId: string,
  operationId: KnowledgeFsCapabilityResponse['operation_id'],
  uploadSessionId?: string,
) {
  return consoleClient.knowledgeFs.spaces.byControlSpaceId.uploadCapabilities.post({
    body: {
      operation_id: operationId,
      ...(uploadSessionId ? { upload_session_id: uploadSessionId } : {}),
    },
    params: { control_space_id: controlSpaceId },
  })
}

async function directPost<T>(admission: KnowledgeFsCapabilityResponse, path: string, body: object) {
  return responseJson<T>(
    await fetch(directUrl(admission.direct_origin, path), {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${admission.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }),
  )
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

async function checksumSha256Base64(data: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer())
  return bytesToBase64(new Uint8Array(digest))
}

async function waitForPhysicalSpace(controlSpaceId: string) {
  const deadline = Date.now() + SPACE_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const space = await consoleClient.knowledgeFs.spaces.byControlSpaceId.get({
      params: { control_space_id: controlSpaceId },
    })
    if (space.state === 'error' || space.state === 'deleted' || space.state === 'deleting')
      throw new Error(`KnowledgeFS space entered ${space.state} state`)
    if (space.state === 'active' && space.knowledge_space_id) return space.knowledge_space_id
    await new Promise((resolve) => setTimeout(resolve, SPACE_READY_POLL_INTERVAL_MS))
  }
  throw new Error('KnowledgeFS space did not become ready in time')
}

async function putPresigned(upload: PresignedUpload, body: Blob) {
  const response = await fetch(upload.url, {
    body,
    headers: upload.headers,
    method: upload.method,
  })
  if (!response.ok) throw new Error(`KnowledgeFS object upload failed with ${response.status}`)
  return response.headers.get('ETag')?.replace(/^"|"$/g, '')
}

async function abortUpload(controlSpaceId: string, knowledgeSpaceId: string, sessionId: string) {
  try {
    const admission = await capability(controlSpaceId, 'abortUploadSession', sessionId)
    await directPost(admission, `/upload-sessions/${encodeURIComponent(sessionId)}/abort`, {
      knowledgeSpaceId,
    })
  } catch {
    // The original upload error is more useful; session expiry remains a safe cleanup path.
  }
}

async function completeUpload(
  controlSpaceId: string,
  knowledgeSpaceId: string,
  sessionId: string,
  parts?: CompletedPart[],
) {
  const admission = await capability(controlSpaceId, 'completeUploadSession', sessionId)
  await directPost(admission, `/upload-sessions/${encodeURIComponent(sessionId)}/complete`, {
    knowledgeSpaceId,
    ...(parts ? { parts } : {}),
  })
}

async function resumeCompletion(
  controlSpaceId: string,
  knowledgeSpaceId: string,
  file: File,
  completion: UploadCompletion,
) {
  if (completion.mode === 'small_fallback') {
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.uploadSessions.byUploadSessionId.smallFile.post(
      {
        body: { file },
        params: {
          control_space_id: controlSpaceId,
          upload_session_id: completion.sessionId,
        },
      },
    )
    return
  }
  await completeUpload(
    controlSpaceId,
    knowledgeSpaceId,
    completion.sessionId,
    completion.mode === 'multipart' ? completion.parts : undefined,
  )
}

async function uploadFile(
  controlSpaceId: string,
  knowledgeSpaceId: string,
  upload: KnowledgeFsUploadItem,
  progress: KnowledgeFsUploadProgress,
) {
  const { file, id } = upload
  const current = progress.get(id) ?? {
    idempotencyKey: id,
    phase: 'pending' as const,
  }
  progress.set(id, current)
  if (current.phase === 'completed') return
  if (current.phase === 'completing') {
    await resumeCompletion(controlSpaceId, knowledgeSpaceId, file, current.completion)
    progress.set(id, { idempotencyKey: current.idempotencyKey, phase: 'completed' })
    return
  }

  const checksum = await checksumSha256Base64(file)
  const createAdmission = await capability(controlSpaceId, 'createUploadSession')
  const created = await directPost<CreateUploadSessionResponse>(
    createAdmission,
    `/knowledge-spaces/${encodeURIComponent(knowledgeSpaceId)}/upload-sessions`,
    {
      checksumSha256Base64: checksum,
      contentType: file.type || 'application/octet-stream',
      expectedSizeBytes: file.size,
      fileName: file.name,
      idempotencyKey: current.idempotencyKey,
    },
  )
  const session = created.session
  if (session.status === 'completed') {
    progress.set(id, { idempotencyKey: current.idempotencyKey, phase: 'completed' })
    return
  }
  if (session.status !== 'ready') {
    progress.set(id, { idempotencyKey: createRequestId(), phase: 'pending' })
    throw new Error(`KnowledgeFS upload session is ${session.status}`)
  }

  try {
    if (session.mode === 'small_fallback') {
      const completion = { mode: session.mode, sessionId: session.id } satisfies UploadCompletion
      progress.set(id, {
        completion,
        idempotencyKey: current.idempotencyKey,
        phase: 'completing',
      })
      await resumeCompletion(controlSpaceId, knowledgeSpaceId, file, completion)
      progress.set(id, { idempotencyKey: current.idempotencyKey, phase: 'completed' })
      return
    }

    if (session.mode === 'single') {
      if (!created.upload) throw new Error('KnowledgeFS did not provide a direct upload URL')
      await putPresigned(created.upload, file)
      const completion = { mode: session.mode, sessionId: session.id } satisfies UploadCompletion
      progress.set(id, {
        completion,
        idempotencyKey: current.idempotencyKey,
        phase: 'completing',
      })
      await resumeCompletion(controlSpaceId, knowledgeSpaceId, file, completion)
      progress.set(id, { idempotencyKey: current.idempotencyKey, phase: 'completed' })
      return
    }

    if (!session.multipartPartCount || !session.multipartPartSizeBytes)
      throw new Error('KnowledgeFS returned an invalid multipart upload plan')

    const parts = []
    for (let partNumber = 1; partNumber <= session.multipartPartCount; partNumber++) {
      const start = (partNumber - 1) * session.multipartPartSizeBytes
      const part = file.slice(start, Math.min(start + session.multipartPartSizeBytes, file.size))
      const partChecksum = await checksumSha256Base64(part)
      const presignAdmission = await capability(
        controlSpaceId,
        'presignUploadSessionPart',
        session.id,
      )
      const upload = await directPost<PresignedPart>(
        presignAdmission,
        `/upload-sessions/${encodeURIComponent(session.id)}/parts/${partNumber}/presign`,
        {
          checksumSha256Base64: partChecksum,
          contentLength: part.size,
          knowledgeSpaceId,
        },
      )
      const etag = await putPresigned(upload, part)
      if (!etag) throw new Error('KnowledgeFS multipart upload response did not include an ETag')
      parts.push({ checksumSha256Base64: partChecksum, etag, partNumber })
    }
    const completion = {
      mode: session.mode,
      parts,
      sessionId: session.id,
    } satisfies UploadCompletion
    progress.set(id, {
      completion,
      idempotencyKey: current.idempotencyKey,
      phase: 'completing',
    })
    await resumeCompletion(controlSpaceId, knowledgeSpaceId, file, completion)
    progress.set(id, { idempotencyKey: current.idempotencyKey, phase: 'completed' })
  } catch (error) {
    if (progress.get(id)?.phase !== 'completing') {
      await abortUpload(controlSpaceId, knowledgeSpaceId, session.id)
      progress.set(id, { idempotencyKey: createRequestId(), phase: 'pending' })
    }
    throw error
  }
}

export async function uploadKnowledgeFsDocuments(
  controlSpaceId: string,
  uploads: KnowledgeFsUploadItem[],
  progress: KnowledgeFsUploadProgress = new Map(),
) {
  const knowledgeSpaceId = await waitForPhysicalSpace(controlSpaceId)
  for (const upload of uploads) await uploadFile(controlSpaceId, knowledgeSpaceId, upload, progress)
}
