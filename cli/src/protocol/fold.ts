import { isRecord } from '@/util/is-record'

export type Hint = {
  summary: string
  op: string
  input: Record<string, unknown>
  form?: unknown
}

export type FoldResult = {
  status: 'incomplete' | 'ended' | 'suspended' | 'failed'
  text: { answer: string; by_source?: Record<string, string> }
  outputs?: Record<string, unknown>
  total_tokens?: number
  message_id?: string
  conversation_id?: string
  error?: { message: string; code?: string }
  hints: Hint[]
}

export type EventHandler = (result: FoldResult, event: Record<string, unknown>) => void

export const FOLD_STATUS = {
  Incomplete: 'incomplete',
  Ended: 'ended',
  Suspended: 'suspended',
  Failed: 'failed',
} as const

type FoldStatus = FoldResult['status']

// Highest precedence first: a handler only ever raises status toward this end.
const STATUS_PRECEDENCE: readonly FoldStatus[] = [
  FOLD_STATUS.Failed,
  FOLD_STATUS.Suspended,
  FOLD_STATUS.Ended,
  FOLD_STATUS.Incomplete,
]

function raise(result: FoldResult, status: FoldStatus): void {
  if (STATUS_PRECEDENCE.indexOf(status) < STATUS_PRECEDENCE.indexOf(result.status))
    result.status = status
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function appendHints(result: FoldResult, hints: unknown): void {
  if (Array.isArray(hints)) result.hints.push(...(hints as Hint[]))
}

function appendAnswer(result: FoldResult, event: Record<string, unknown>): void {
  const answer = asString(event.answer)
  if (answer !== undefined) result.text.answer += answer
}

function replaceAnswer(result: FoldResult, event: Record<string, unknown>): void {
  const answer = asString(event.answer)
  if (answer !== undefined) result.text.answer = answer
}

function appendTextChunk(result: FoldResult, event: Record<string, unknown>): void {
  const data = asRecord(event.data)
  if (data === undefined) return
  const selector = data.from_variable_selector
  if (!Array.isArray(selector)) return
  const key = selector.map((part) => String(part)).join('.')
  const text = asString(data.text) ?? ''
  result.text.by_source ??= {}
  result.text.by_source[key] = (result.text.by_source[key] ?? '') + text
}

function endMessage(result: FoldResult, event: Record<string, unknown>): void {
  const messageId = asString(event.message_id)
  if (messageId !== undefined) result.message_id = messageId
  const conversationId = asString(event.conversation_id)
  if (conversationId !== undefined) result.conversation_id = conversationId
  appendHints(result, event.hints)
  raise(result, FOLD_STATUS.Ended)
}

const WORKFLOW_FAILURE_STATUSES: readonly string[] = ['failed', 'stopped']

function finishWorkflow(result: FoldResult, event: Record<string, unknown>): void {
  const data = asRecord(event.data)
  if (data === undefined) return
  const outputs = asRecord(data.outputs)
  if (outputs !== undefined) result.outputs = outputs
  if (typeof data.total_tokens === 'number') result.total_tokens = data.total_tokens
  const status = asString(data.status)
  if (status !== undefined && WORKFLOW_FAILURE_STATUSES.includes(status)) {
    result.error = { message: asString(data.error) ?? '' }
    raise(result, FOLD_STATUS.Failed)
    return
  }
  raise(result, FOLD_STATUS.Ended)
}

function requireHumanInput(result: FoldResult, event: Record<string, unknown>): void {
  appendHints(result, event.hints)
  raise(result, FOLD_STATUS.Suspended)
}

function markError(result: FoldResult, event: Record<string, unknown>): void {
  const message = asString(event.message) ?? ''
  const code = asString(event.code)
  result.error = code !== undefined ? { message, code } : { message }
  raise(result, FOLD_STATUS.Failed)
}

export const FOLD_TABLE: Readonly<Record<string, EventHandler>> = Object.freeze({
  message: appendAnswer,
  agent_message: appendAnswer,
  message_replace: replaceAnswer,
  text_chunk: appendTextChunk,
  message_end: endMessage,
  workflow_finished: finishWorkflow,
  human_input_required: requireHumanInput,
  error: markError,
})
