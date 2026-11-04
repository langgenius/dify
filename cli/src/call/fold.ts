import type { ExitCodeValue } from '@/errors/codes'
import type { FoldResult, FoldStatus } from '@/protocol/fold'
import { ExitCode } from '@/errors/codes'
import { FOLD_STATUS, FOLD_TABLE, foldAnyEvent } from '@/protocol/fold'

export function newFoldResult(): FoldResult {
  return { status: FOLD_STATUS.Incomplete, text: { answer: '' }, hints: [] }
}

export function foldEvent(result: FoldResult, name: string, event: Record<string, unknown>): void {
  foldAnyEvent(result, event)
  FOLD_TABLE[name]?.(result, event)
}

export function finishFold(result: FoldResult): FoldResult {
  if (result.status !== FOLD_STATUS.Incomplete) delete result.text.by_source
  return result
}

const OP_FOLLOW_RUN = 'get.run.event'
const HINT_FOLLOW_RUN = 'The run may still be running on the server. Follow it to its end'

/**
 * The stream ended before a terminal event. Only a workflow run can be followed again, and only
 * when the call named its app and an event named the run; any other hint would not be true.
 */
export function foldBrokenStream(
  result: FoldResult,
  input: Readonly<Record<string, unknown>>,
): void {
  if (result.status !== FOLD_STATUS.Incomplete) return
  const appId = input.app_id
  if (typeof appId !== 'string' || result.run_id === undefined) return
  result.hints.push({
    summary: HINT_FOLLOW_RUN,
    op: OP_FOLLOW_RUN,
    input: { app_id: appId, run_id: result.run_id },
  })
}

const EXIT_CODES: Readonly<Record<FoldStatus, ExitCodeValue>> = {
  [FOLD_STATUS.Ended]: ExitCode.Success,
  [FOLD_STATUS.Suspended]: ExitCode.Success,
  [FOLD_STATUS.Failed]: ExitCode.Generic,
  [FOLD_STATUS.Incomplete]: ExitCode.Generic,
}

export function exitCodeFor(result: FoldResult): ExitCodeValue {
  return EXIT_CODES[result.status]
}
