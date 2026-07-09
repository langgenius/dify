import type {
  SkillAssistAttachmentPayload,
  SkillFileUploadResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  DefaultModel,
  FormValue,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
// oxlint-disable-next-line no-restricted-imports
import type { IOnCompleted, IOnData, IOnError } from '@/service/base'
// oxlint-disable-next-line no-restricted-imports
import { get, post, ssePost, upload } from '@/service/base'

function parseSkillUploadErrorMessage(message: string) {
  const trimmedMessage = message.trim()
  if (!trimmedMessage.startsWith('{')) return trimmedMessage

  try {
    const parsed: unknown = JSON.parse(trimmedMessage)
    if (parsed && typeof parsed === 'object') {
      const parsedMessage = (parsed as Record<string, unknown>).message
      if (typeof parsedMessage === 'string' && parsedMessage.trim()) return parsedMessage.trim()
    }
  } catch {
    return trimmedMessage
  }

  return trimmedMessage
}

function readSkillUploadErrorMessage(
  error: unknown,
  visited = new Set<unknown>(),
): string | undefined {
  if (!error || visited.has(error)) return undefined
  if (typeof error === 'string') return parseSkillUploadErrorMessage(error)
  if (typeof error !== 'object') return undefined

  visited.add(error)
  const record = error as Record<string, unknown>

  for (const key of ['data', 'body', 'error', 'cause', 'response']) {
    const nestedMessage = readSkillUploadErrorMessage(record[key], visited)
    if (nestedMessage) return nestedMessage
  }

  const message = record.message
  if (typeof message === 'string' && message.trim()) return parseSkillUploadErrorMessage(message)

  return undefined
}

async function getSkillUploadResponseErrorMessage(response: Response) {
  try {
    const data: unknown = await response.clone().json()
    return readSkillUploadErrorMessage(data)
  } catch {
    try {
      const text = await response.clone().text()
      if (text.trim()) return parseSkillUploadErrorMessage(text)
    } catch {}
  }
}

export async function uploadSkillFile(
  file: File,
  options?: {
    onProgress?: (progress: number) => void
  },
) {
  const body = new FormData()
  body.append('file', file)

  try {
    if (options?.onProgress) {
      const onProgress = (event: ProgressEvent) => {
        if (!event.lengthComputable) return

        options.onProgress?.(Math.floor((event.loaded / event.total) * 100))
      }

      const response = await upload(
        {
          xhr: new XMLHttpRequest(),
          data: body,
          onprogress: onProgress,
        },
        false,
        '/workspaces/current/skills/files/upload',
      )

      return response as SkillFileUploadResponse
    }

    return await post<SkillFileUploadResponse>(
      '/workspaces/current/skills/files/upload',
      { body },
      {
        bodyStringify: false,
        deleteContentType: true,
        silent: true,
      },
    )
  } catch (error) {
    const message =
      error instanceof Response
        ? await getSkillUploadResponseErrorMessage(error)
        : readSkillUploadErrorMessage(error)

    if (message) {
      const normalizedError = new Error(message)
      normalizedError.cause = error
      throw normalizedError
    }

    throw error
  }
}

export async function fetchSkillFileBlob({
  download = false,
  path,
  skillId,
  versionId,
}: {
  download?: boolean
  path: string
  skillId: string
  versionId: string | null
}) {
  const params = new URLSearchParams({ path })
  if (versionId) params.set('version_id', versionId)
  if (download) params.set('download', '1')

  const response = await get<Response>(
    `/workspaces/current/skills/${encodeURIComponent(skillId)}/files/content?${params.toString()}`,
    {},
    { needAllResponseContent: true },
  )
  return response.blob()
}

export function sendSkillAssistMessage({
  attachments,
  getAbortController,
  message,
  model,
  onCompleted,
  onData,
  onError,
  skillId,
}: {
  attachments?: SkillAssistAttachmentPayload[]
  getAbortController?: (abortController: AbortController) => void
  message: string
  model?: DefaultModel & {
    model_settings?: FormValue
  }
  onCompleted?: IOnCompleted
  onData?: IOnData
  onError?: IOnError
  skillId: string
}) {
  return ssePost(
    `/workspaces/current/skills/${encodeURIComponent(skillId)}/assist/messages`,
    {
      body: {
        attachments,
        message,
        model,
      },
    },
    {
      getAbortController,
      onCompleted,
      onData,
      onError,
    },
  )
}
