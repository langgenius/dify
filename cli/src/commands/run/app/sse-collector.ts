import type { BaseError } from '@/errors/base'
import type { SseEvent } from '@/http/sse'
import { HttpClientError, newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { parseReasoningChunk } from '@/sys/io/reasoning'
import { RUN_MODES } from './handlers'

export type HitlPauseData = {
  form_id: string
  node_id: string
  node_title: string
  form_content: string
  inputs: unknown[]
  actions: unknown[]
  display_in_ui: boolean
  form_token: string | null
  // Channels where the form can be approved when it is not CLI-resumable, e.g. ['email'].
  approval_channels?: string[]
  resolved_default_values: Record<string, string>
  expiration_time: number
}

export type HitlPausePayload = {
  event: 'human_input_required'
  task_id: string
  workflow_run_id: string
  data: HitlPauseData
}

export class HitlPauseError extends Error {
  readonly pausePayload: HitlPausePayload
  constructor(payload: HitlPausePayload) {
    super('workflow paused for human input')
    this.name = 'HitlPauseError'
    this.pausePayload = payload
  }
}

export type Collector = {
  consume: (ev: SseEvent) => void
  finalize: () => Record<string, unknown>
}

const dec = new TextDecoder()

function parseJson(data: Uint8Array): Record<string, unknown> {
  if (data.byteLength === 0)
    return {}
  try {
    return JSON.parse(dec.decode(data)) as Record<string, unknown>
  }
  catch (e) {
    throw newError(ErrorCode.Unknown, `decode SSE event: ${(e as Error).message}`)
  }
}

function copyScalar(dst: Record<string, unknown>, src: Record<string, unknown>, keys: readonly string[]): void {
  for (const k of keys) {
    if (k in dst)
      continue
    if (k in src)
      dst[k] = src[k]
  }
}

class ChatCollector implements Collector {
  private answer = ''
  private base: Record<string, unknown> = {}
  private metadata: Record<string, unknown> | undefined
  private thoughts: unknown[] = []
  private readonly reasoning: Record<string, string> = {}
  private readonly mode: string
  private readonly isAgent: boolean
  constructor(mode: string, isAgent: boolean) {
    this.mode = mode
    this.isAgent = isAgent
  }

  consume(ev: SseEvent): void {
    const c = parseJson(ev.data)
    switch (ev.name) {
      case 'message':
      case 'agent_message': {
        if (typeof c.answer === 'string')
          this.answer += c.answer
        copyScalar(this.base, c, ['id', 'conversation_id', 'message_id', 'task_id', 'created_at'])
        return
      }
      // Accumulate separated-mode reasoning deltas per LLM node.
      case 'reasoning_chunk': {
        const chunk = parseReasoningChunk(c)
        if (chunk !== undefined && chunk.reasoning !== '') {
          const key = chunk.nodeId !== '' ? chunk.nodeId : '_'
          this.reasoning[key] = (this.reasoning[key] ?? '') + chunk.reasoning
        }
        return
      }
      case 'agent_thought':
        this.thoughts.push(c)
        return
      case 'message_end':
        if (c.metadata !== undefined && typeof c.metadata === 'object' && c.metadata !== null)
          this.metadata = c.metadata as Record<string, unknown>
        copyScalar(this.base, c, ['id', 'conversation_id', 'message_id', 'task_id', 'created_at'])
    }
  }

  finalize(): Record<string, unknown> {
    const out: Record<string, unknown> = { mode: this.mode, answer: this.answer, ...this.base }
    if (this.metadata !== undefined)
      out.metadata = this.metadata
    // Fall back to live deltas only when the server didn't persist reasoning in metadata.
    if (Object.keys(this.reasoning).length > 0 && !hasReasoning(this.metadata))
      out.metadata = { ...(this.metadata ?? {}), reasoning: this.reasoning }
    if (this.isAgent || this.thoughts.length > 0)
      out.agent_thoughts = this.thoughts
    return out
  }
}

function hasReasoning(metadata: Record<string, unknown> | undefined): boolean {
  const reasoning = metadata?.reasoning
  return reasoning !== null
    && typeof reasoning === 'object'
    && !Array.isArray(reasoning)
    && Object.keys(reasoning as object).length > 0
}

class CompletionCollector implements Collector {
  private answer = ''
  private base: Record<string, unknown> = {}
  private metadata: Record<string, unknown> | undefined
  consume(ev: SseEvent): void {
    const c = parseJson(ev.data)
    switch (ev.name) {
      case 'message':
        if (typeof c.answer === 'string')
          this.answer += c.answer
        copyScalar(this.base, c, ['id', 'message_id', 'task_id', 'created_at'])
        return
      case 'message_end':
        if (c.metadata !== undefined && typeof c.metadata === 'object' && c.metadata !== null)
          this.metadata = c.metadata as Record<string, unknown>
        copyScalar(this.base, c, ['id', 'message_id', 'task_id', 'created_at'])
    }
  }

  finalize(): Record<string, unknown> {
    const out: Record<string, unknown> = { mode: RUN_MODES.Completion, answer: this.answer, ...this.base }
    if (this.metadata !== undefined)
      out.metadata = this.metadata
    return out
  }
}

class WorkflowCollector implements Collector {
  private final: Record<string, unknown> | undefined
  private readonly reasoning: Record<string, string> = {}
  consume(ev: SseEvent): void {
    if (ev.name === 'reasoning_chunk') {
      const chunk = parseReasoningChunk(parseJson(ev.data))
      if (chunk !== undefined && chunk.reasoning !== '') {
        const key = chunk.nodeId !== '' ? chunk.nodeId : '_'
        this.reasoning[key] = (this.reasoning[key] ?? '') + chunk.reasoning
      }
      return
    }
    if (ev.name !== 'workflow_finished')
      return
    this.final = parseJson(ev.data)
  }

  finalize(): Record<string, unknown> {
    const out: Record<string, unknown> = { mode: RUN_MODES.Workflow, ...(this.final ?? {}) }
    // Workflow runs don't persist reasoning; surface live deltas under metadata.reasoning.
    if (Object.keys(this.reasoning).length > 0) {
      const existing = (out.metadata !== null && typeof out.metadata === 'object' && !Array.isArray(out.metadata))
        ? out.metadata as Record<string, unknown>
        : undefined
      out.metadata = { ...(existing ?? {}), reasoning: this.reasoning }
    }
    return out
  }
}

const FACTORIES: Record<string, () => Collector> = {
  [RUN_MODES.Chat]: () => new ChatCollector(RUN_MODES.Chat, false),
  [RUN_MODES.AdvancedChat]: () => new ChatCollector(RUN_MODES.AdvancedChat, false),
  [RUN_MODES.AgentChat]: () => new ChatCollector(RUN_MODES.AgentChat, true),
  [RUN_MODES.Completion]: () => new CompletionCollector(),
  [RUN_MODES.Workflow]: () => new WorkflowCollector(),
}

export function collectorFor(mode: string): Collector {
  const f = FACTORIES[mode]
  if (f === undefined)
    throw newError(ErrorCode.Unknown, `unsupported streaming mode "${mode}"`)
  return f()
}

export function decodeStreamError(data: Uint8Array): BaseError {
  type Env = { message?: string, code?: string, status?: number }
  let env: Env = {}
  if (data.byteLength > 0) {
    try {
      env = JSON.parse(dec.decode(data)) as Env
    }
    catch {}
  }
  const rawMessage = env.message !== undefined && env.message !== ''
    ? env.message
    : 'stream terminated by error event'
  const message = unwrapInvokeErrorMessage(rawMessage)
  const code = env.status !== undefined && env.status > 0 && env.status < 500
    ? ErrorCode.Server4xxOther
    : ErrorCode.Server5xx
  const err = newError(code, message)
  if (env.status !== undefined && env.status > 0)
    return HttpClientError.from(err).withHttpStatus(env.status)
  return err
}

function unwrapInvokeErrorMessage(raw: string): string {
  if (!raw.startsWith('{'))
    return raw
  type InvokeErrorEnv = {
    error_type?: string
    args?: { description?: string }
    message?: string
  }
  try {
    const inner = JSON.parse(raw) as InvokeErrorEnv
    if (inner.error_type === undefined)
      return raw
    return inner.args?.description ?? inner.message ?? raw
  }
  catch {
    return raw
  }
}

const SILENT_EVENTS = new Set([
  'node_retry',
  'iteration_started',
  'iteration_next',
  'iteration_completed',
  'loop_started',
  'loop_next',
  'loop_completed',
])

export async function collect(
  iter: AsyncIterable<SseEvent>,
  mode: string,
): Promise<Record<string, unknown>> {
  const c = collectorFor(mode)
  for await (const ev of iter) {
    if (ev.name === 'ping' || SILENT_EVENTS.has(ev.name))
      continue
    if (ev.name === 'error')
      throw decodeStreamError(ev.data)
    if (ev.name === 'human_input_required') {
      throw new HitlPauseError(parseJson(ev.data) as unknown as HitlPausePayload)
    }
    if (ev.name === 'workflow_paused') {
      throw newError(ErrorCode.Unknown, 'workflow paused (non-interactive pause; check server logs)')
    }
    c.consume(ev)
  }
  return c.finalize()
}
