import type { AppRunClient } from '../../../../api/app-run.js'
import type { AppRunPrintFlags } from '../print-flags.js'
import type { RunAppDeps, RunAppOptions } from '../run.js'
import { StreamingStructuredStrategy } from './streaming-structured.js'
import { StreamingTextStrategy } from './streaming-text.js'

export type RunContext = {
  readonly opts: RunAppOptions & { inputs: Record<string, unknown> }
  readonly deps: RunAppDeps
  readonly mode: string
  readonly format: string
  readonly isText: boolean
  readonly livePrint: boolean
  readonly runClient: AppRunClient
  readonly printFlags: AppRunPrintFlags
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
