import type { Hint } from '@/protocol/hint'
import { parseHints } from '@/protocol/hint'
import { isRecord } from '@/util/is-record'

export type FoldResult = {
  status: FoldStatus
  text: { answer: string; by_source?: Record<string, string> }
  outputs?: Record<string, unknown>
  total_tokens?: number
  message_id?: string
  conversation_id?: string
  run_id?: string
  error?: { message: string; code?: string }
  hints: Hint[]
}

type HintGroup =
  | { source: 'message'; hints: Hint[] }
  | { source: 'form'; formId: string | undefined; hints: Hint[] }

export type FoldState = Omit<FoldResult, 'hints'> & { hintGroups: HintGroup[] }

export type EventHandler = (result: FoldState, event: Record<string, unknown>) => void

export const FOLD_STATUS = {
  Incomplete: 'incomplete',
  Ended: 'ended',
  Suspended: 'suspended',
  Failed: 'failed',
} as const

type FoldStatus = (typeof FOLD_STATUS)[keyof typeof FOLD_STATUS]

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function appendAnswer(result: FoldState, event: Record<string, unknown>): void {
  const answer = asString(event.answer)
  if (answer !== undefined) result.text.answer += answer
}

function replaceAnswer(result: FoldState, event: Record<string, unknown>): void {
  const answer = asString(event.answer)
  if (answer !== undefined) result.text.answer = answer
}

function appendTextChunk(result: FoldState, event: Record<string, unknown>): void {
  const data = asRecord(event.data)
  if (data === undefined) return
  const selector = data.from_variable_selector
  if (!Array.isArray(selector)) return
  const key = selector.map((part) => String(part)).join('.')
  const text = asString(data.text) ?? ''
  result.text.by_source ??= {}
  result.text.by_source[key] = (result.text.by_source[key] ?? '') + text
}

function endMessage(result: FoldState, event: Record<string, unknown>): void {
  const messageId = asString(event.message_id)
  if (messageId !== undefined) result.message_id = messageId
  const conversationId = asString(event.conversation_id)
  if (conversationId !== undefined) result.conversation_id = conversationId
  result.hintGroups.push({ source: 'message', hints: parseHints(event.hints) })
  // A chatflow can emit message_end before workflow_finished reports a stop.
  if (result.run_id === undefined && result.status === FOLD_STATUS.Incomplete)
    result.status = FOLD_STATUS.Ended
}

const WORKFLOW_FAILURE_STATUSES: readonly string[] = ['failed', 'stopped']

function finishWorkflow(result: FoldState, event: Record<string, unknown>): void {
  const data = asRecord(event.data)
  if (data === undefined) return
  const outputs = asRecord(data.outputs)
  if (outputs !== undefined) result.outputs = outputs
  if (typeof data.total_tokens === 'number') result.total_tokens = data.total_tokens
  const status = asString(data.status)
  if (status !== undefined && WORKFLOW_FAILURE_STATUSES.includes(status)) {
    result.error = { message: asString(data.error) ?? '' }
    result.status = FOLD_STATUS.Failed
    return
  }
  if (result.status !== FOLD_STATUS.Failed) result.status = FOLD_STATUS.Ended
}

function requireHumanInput(result: FoldState, event: Record<string, unknown>): void {
  const formId = asString(asRecord(event.data)?.form_id)
  const hints = parseHints(event.hints)
  const existing = result.hintGroups.find(
    (group) => formId !== undefined && group.source === 'form' && group.formId === formId,
  )
  if (existing) existing.hints = hints
  else result.hintGroups.push({ source: 'form', formId, hints })
  if (result.status !== FOLD_STATUS.Failed) result.status = FOLD_STATUS.Suspended
}

function resolveHumanInput(result: FoldState, event: Record<string, unknown>): void {
  const formId = asString(asRecord(event.data)?.form_id)
  if (formId === undefined) return
  result.hintGroups = result.hintGroups.filter(
    (group) => group.source !== 'form' || group.formId !== formId,
  )
  if (
    result.status === FOLD_STATUS.Suspended &&
    !result.hintGroups.some((group) => group.source === 'form')
  )
    result.status = FOLD_STATUS.Incomplete
}

function markError(result: FoldState, event: Record<string, unknown>): void {
  const message = asString(event.message) ?? ''
  const code = asString(event.code)
  result.error = code !== undefined ? { message, code } : { message }
  result.status = FOLD_STATUS.Failed
}

/** Runs for every event before its own handler: any workflow event names its run. */
export const foldAnyEvent: EventHandler = (result, event) => {
  const runId = asString(event.workflow_run_id)
  if (runId !== undefined) result.run_id = runId
}

export const FOLD_TABLE: Readonly<Record<string, EventHandler>> = Object.freeze({
  message: appendAnswer,
  agent_message: appendAnswer,
  message_replace: replaceAnswer,
  text_chunk: appendTextChunk,
  message_end: endMessage,
  workflow_finished: finishWorkflow,
  human_input_required: requireHumanInput,
  human_input_form_filled: resolveHumanInput,
  human_input_form_timeout: resolveHumanInput,
  error: markError,
})
