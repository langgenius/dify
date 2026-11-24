import type {
  SkillAssistAttachmentPayload,
  SkillAssistHistoryMessagePayload,
  SkillFileUploadResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  DefaultModel,
  FormValue,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
// oxlint-disable-next-line no-restricted-imports
import type { IOnCompleted, IOnData, IOnError } from '@/service/base'
// oxlint-disable-next-line no-restricted-imports
import { get, ssePost } from '@/service/base'
import { consoleClient } from '@/service/console'

export async function uploadSkillFile(
  file: File,
  options?: {
    onProgress?: (progress: number) => void
    signal?: AbortSignal
  },
): Promise<SkillFileUploadResponse> {
  const onProgress = options?.onProgress
  return consoleClient.workspaces.current.skills.files.upload.post(
    { body: { file } },
    {
      context: {
        silent: true,
        ...(onProgress && {
          onUploadProgress: ({ loaded, total }: { loaded: number; total: number }) => {
            onProgress(Math.floor((loaded / total) * 100))
          },
        }),
      },
      signal: options?.signal,
    },
  )
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
    { needAllResponseContent: true, silent: true },
  )
  return response.blob()
}

export async function fetchSkillArchiveBlob(skillId: string) {
  const response = await get<Response>(
    `/workspaces/current/skills/${encodeURIComponent(skillId)}/export`,
    {},
    { needAllResponseContent: true, silent: true },
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
  onUnhandledEvent,
  skillId,
  targetPath,
  history,
}: {
  attachments?: SkillAssistAttachmentPayload[]
  history?: SkillAssistHistoryMessagePayload[]
  getAbortController?: (abortController: AbortController) => void
  message: string
  model?: DefaultModel & {
    model_settings?: FormValue
  }
  onCompleted?: IOnCompleted
  onData?: IOnData
  onError?: IOnError
  onUnhandledEvent?: (event: Record<string, unknown>) => void
  skillId: string
  targetPath?: string
}) {
  let streamErrorHandled = false
  return ssePost(
    `/workspaces/current/skills/${encodeURIComponent(skillId)}/assist/messages`,
    {
      body: {
        attachments,
        history,
        message,
        model,
        target_path: targetPath,
      },
    },
    {
      silent: true,
      getAbortController,
      onCompleted: (hasError, errorMessage) => {
        onCompleted?.(streamErrorHandled && hasError ? false : hasError, errorMessage)
      },
      onData: (chunk, isFirstMessage, moreInfo) => {
        if (moreInfo.errorMessage) {
          streamErrorHandled = true
          onError?.(moreInfo.errorMessage, moreInfo.errorCode)
          return
        }

        onData?.(chunk, isFirstMessage, moreInfo)
      },
      onError: (errorMessage, errorCode) => {
        streamErrorHandled = true
        onError?.(errorMessage, errorCode)
      },
      onUnhandledEvent,
    },
  )
}
