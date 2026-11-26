import type {
  DifyBuilderAttachmentPayload,
  DifyBuilderCommandSubmissionResponse,
  DifyBuilderCreatedSessionResponse,
  DifyBuilderWorkflowEventData,
  RunStatus,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { CanvasEventData, ConversationItem, SessionView } from '../types'

export type SessionRunEvents = {
  onAttachmentsAccepted?: (attachments: DifyBuilderAttachmentPayload[], text?: string) => void
  clearAttachmentDraft?: () => void
  onCommandStarted?: () => void
  onSessionStateChanged?: (state: Pick<SessionView, 'phase' | 'run_status'>) => void
  onWorkflowEvent: (event: DifyBuilderWorkflowEventData) => void
  onStreamInterrupted: () => void
  onCanvasEvent: (event: CanvasEventData) => void
  restoreRun: (sessionId: string, items: ConversationItem[]) => void
  finishCommand: () => void
  reset: () => void
  onCanvasRefreshed: () => void
}

export type SessionCommandOptions = (
  | {
      submit: (signal: AbortSignal) => Promise<DifyBuilderCommandSubmissionResponse>
      knownSessionId: string
      create?: never
      prepareExisting?: never
    }
  | {
      create: (signal: AbortSignal) => Promise<DifyBuilderCreatedSessionResponse>
      prepareExisting?: () => Promise<boolean>
      knownSessionId?: never
      submit?: never
    }
) & {
  prepareDraft?: boolean
  initialAttachments?: DifyBuilderAttachmentPayload[]
  trace?: { kind: string; payload: unknown }
}

export type SessionStreamOutcome = {
  terminalEvent: 'command_finished' | 'error'
  terminalError?: string
  terminalErrorCode?: string
  terminalInterrupted?: boolean
  terminalRunStatus?: RunStatus
  finishedCommandId?: string
  stateApplied: boolean
  retest?: PendingRetest
}

export type PendingRetest = {
  sessionId: string
  version: number
  appRevision: string
  actionId: string
}
