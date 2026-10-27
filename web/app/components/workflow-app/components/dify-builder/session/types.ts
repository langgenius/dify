import type {
  DifyBuilderStreamEventResponse,
  DifyBuilderWorkflowEventData,
  RunStatus,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { CanvasEventData, ConversationItem, SessionView } from '../types'

export type SessionRunEvents = {
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

export type SessionCommandOptions = {
  openStream: (signal: AbortSignal) => Promise<AsyncIterable<DifyBuilderStreamEventResponse>>
  knownSessionId?: string
  expectTerminalEvent: boolean
  startsSession?: boolean
  prepareDraft?: boolean
  trace?: { kind: string; payload: unknown }
}

export type SessionStreamOutcome = {
  sessionId?: string
  sawCommandStarted: boolean
  terminalEvent: 'command_finished' | 'error' | null
  terminalError?: string
  terminalErrorCode?: string
  terminalInterrupted?: boolean
  terminalRunStatus?: RunStatus
  transportError?: string
  transportStatus?: number
  observedVersion?: number
  commandStartedVersion?: number
  conversationStartSeq?: number
  commandId?: string
  finishedCommandId?: string
  stateApplied?: boolean
}
