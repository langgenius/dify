import type { ExitCodeValue } from '@/errors/codes'
import type { FoldResult } from '@/protocol/fold'
import { ExitCode } from '@/errors/codes'
import { FOLD_STATUS, FOLD_TABLE } from '@/protocol/fold'

export function newFoldResult(): FoldResult {
  return { status: FOLD_STATUS.Incomplete, text: { answer: '' }, hints: [] }
}

export function foldEvent(result: FoldResult, name: string, event: Record<string, unknown>): void {
  const handler = FOLD_TABLE[name]
  if (handler !== undefined) handler(result, event)
}

export function finishFold(result: FoldResult): FoldResult {
  if (result.status !== FOLD_STATUS.Incomplete) delete result.text.by_source
  return result
}

export function exitCodeFor(result: FoldResult): ExitCodeValue {
  return result.status === FOLD_STATUS.Failed ? ExitCode.Generic : ExitCode.Success
}
