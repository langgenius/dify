import type { AppRunClient } from '@/api/app-run'
import type { RunAppDeps, RunAppOptions } from '@/commands/run/app/run'
import { StreamingStructuredStrategy } from './streaming-structured'
import { StreamingTextStrategy } from './streaming-text'

export type RunContext = {
  readonly opts: RunAppOptions & { inputs: Record<string, unknown> }
  readonly deps: RunAppDeps
  readonly mode: string
  readonly format: string
  readonly isText: boolean
  readonly livePrint: boolean
  readonly runClient: AppRunClient
  readonly exit: (code: number) => never
  readonly think: boolean
}

export type RunStrategy = {
  execute: (ctx: RunContext) => Promise<void>
}

const streamingText = new StreamingTextStrategy()
const streamingStructured = new StreamingStructuredStrategy()

export function pickStrategy(isText: boolean, livePrint: boolean): RunStrategy {
  return isText && livePrint ? streamingText : streamingStructured
}
