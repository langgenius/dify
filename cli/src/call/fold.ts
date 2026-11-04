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

const OP_LIST_RUNS = 'get.run'
const OP_DESCRIBE_RUN = 'describe.run'
const HINT_SEEN_RUN = 'The run may still be running on the server. Read it to see where it got to'
const HINT_UNSEEN_RUN =
  'No run id arrived before the stream broke. The run may still be running on the server. List the newest runs of the app to find it'

/** The stream broke before a terminal event: say how to find the run, which may still be going. */
export function foldBrokenStream(
  result: FoldResult,
  input: Readonly<Record<string, unknown>>,
): void {
  const appId = typeof input.app_id === 'string' ? input.app_id : undefined
  const appInput = appId === undefined ? undefined : { app_id: appId }
  if (result.run_id !== undefined) {
    result.hints.push({
      summary: HINT_SEEN_RUN,
      op: OP_DESCRIBE_RUN,
      input: { ...appInput, run_id: result.run_id },
    })
  }
  result.hints.push({
    summary: result.run_id === undefined ? HINT_UNSEEN_RUN : 'List the newest runs of the app',
    op: OP_LIST_RUNS,
    input: appInput,
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
