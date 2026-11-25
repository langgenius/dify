import type { ExitCodeValue } from '@/errors/codes'
import type { FoldResult, FoldState } from '@/protocol/fold'
import { ExitCode } from '@/errors/codes'
import { FOLD_STATUS, FOLD_TABLE, foldAnyEvent } from '@/protocol/fold'

export function newFoldResult(): FoldState {
  return { status: FOLD_STATUS.Incomplete, text: { answer: '' }, hintGroups: [] }
}

export function foldEvent(result: FoldState, name: string, event: Record<string, unknown>): void {
  foldAnyEvent(result, event)
  FOLD_TABLE[name]?.(result, event)
}

export function finishFold({ hintGroups, ...result }: FoldState): FoldResult {
  const hints = hintGroups.flatMap((group) =>
    group.source === 'message' || result.status === FOLD_STATUS.Suspended ? group.hints : [],
  )
  if (result.status !== FOLD_STATUS.Incomplete) delete result.text.by_source
  return { ...result, hints }
}

export function exitCodeFor(result: Pick<FoldResult, 'status'>): ExitCodeValue {
  return result.status === FOLD_STATUS.Failed ? ExitCode.Generic : ExitCode.Success
}
