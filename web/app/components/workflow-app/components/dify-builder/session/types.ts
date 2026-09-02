import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'

export type SessionCommandOptions = {
  openStream: (signal: AbortSignal) => Promise<AsyncIterable<DifyBuilderStreamEventResponse>>
  knownSessionId?: string
  expectTerminalEvent: boolean
  startsSession?: boolean
}

export type SessionStreamOutcome = {
  sessionId?: string
  sawSnapshot: boolean
  terminalEvent: 'state' | 'error' | null
  terminalError?: string
  transportError?: string
  stateApplied?: boolean
}
