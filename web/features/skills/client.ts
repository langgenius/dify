import type {
  SkillAssistAttachmentPayload,
  SkillAssistHistoryMessagePayload,
  SkillFileUploadResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  DefaultModel,
  FormValue,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { IOnCompleted, IOnData, IOnError } from '@/service/event-stream'
import { noop } from 'es-toolkit/function'
import { consoleClient } from '@/service/console'
import { streamEvents } from '@/service/event-stream'

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
}): Promise<Blob> {
  return consoleClient.workspaces.current.skills.bySkillId.files.content.get({
    params: { skill_id: skillId },
    query: {
      path,
      ...(versionId && { version_id: versionId }),
      ...(download && { download: '1' }),
    },
  })
}

export async function fetchSkillArchiveBlob(skillId: string): Promise<Blob> {
  return consoleClient.workspaces.current.skills.bySkillId.export.get({
    params: { skill_id: skillId },
  })
}

export async function sendSkillAssistMessage({
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
  streamEvents(
    (options) =>
      consoleClient.workspaces.current.skills.bySkillId.assist.messages.post(
        {
          params: { skill_id: skillId },
          body: {
            attachments,
            history,
            message,
            model,
            target_path: targetPath,
          },
        },
        options,
      ),
    {
      onNotifyError: noop,
      getAbortController,
      onCompleted: (hasError, errorMessage) => {
        onCompleted?.(streamErrorHandled && hasError ? false : hasError, errorMessage)
      },
      onData,
      onError: (errorMessage, errorCode) => {
        streamErrorHandled = true
        onError?.(errorMessage, errorCode)
      },
      onUnhandledEvent,
    },
  )
}
