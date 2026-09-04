import type {
  DifyBuilderStreamEventResponse,
  RunStatus,
} from '@dify/contracts/api/console/dify-builder/types.gen'

export type SessionCommandOptions = {
  openStream: (signal: AbortSignal) => Promise<AsyncIterable<DifyBuilderStreamEventResponse>>
  knownSessionId?: string
  expectTerminalEvent: boolean
  startsSession?: boolean
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
