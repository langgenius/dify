import type {
  CanvasEventData,
  DifyBuilderStreamEventResponse,
  DifyBuilderWorkflowEventData,
  RunStatus,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ConversationItem } from '../types'

export type SessionRunEvents = {
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
  trace?: { kind: string; payload: unknown }
}

export type SessionStreamOutcome = {
  sessionId?: string
  sawCommandStarted: boolean
  terminalEvent: 'state' | 'error' | null
  terminalError?: string
  terminalInterrupted?: boolean
  terminalRunStatus?: RunStatus
  transportError?: string
  transportStatus?: number
  observedVersion?: number
  commandStartedVersion?: number
  observedCommitVersion?: number
  stateApplied?: boolean
}
