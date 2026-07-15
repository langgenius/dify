import type { HitlPausePayload } from './sse-collector'
import type { StreamPrinter } from '@/framework/stream'
import type { SseEvent } from '@/http/sse'
import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { parseReasoningChunk, ReasoningChunkRenderer } from '@/sys/io/reasoning'
import { filterThinkInOutputs, ThinkChunkFilter } from '@/sys/io/think-filter'
import { RUN_MODES } from './handlers'
import { HitlPauseError } from './sse-collector'

const dec = new TextDecoder()

function parseJson(data: Uint8Array): Record<string, unknown> {
  if (data.byteLength === 0) return {}
  try {
    return JSON.parse(dec.decode(data)) as Record<string, unknown>
  } catch {
    return {}
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

function handleCommonEvents(ev: SseEvent): boolean {
  if (SILENT_EVENTS.has(ev.name)) return true
  if (ev.name === 'human_input_required') {
    throw new HitlPauseError(parseJson(ev.data) as unknown as HitlPausePayload)
  }
  return false
}

class ChatStreamPrinter implements StreamPrinter {
  private convoId = ''
  private readonly filter: ThinkChunkFilter
  private readonly reasoning = new ReasoningChunkRenderer()
  private readonly think: boolean
  private readonly isTTY: boolean
  constructor(think: boolean, isTTY = false) {
    this.filter = new ThinkChunkFilter(think)
    this.think = think
    this.isTTY = isTTY
  }

  onEvent(out: NodeJS.WritableStream, errOut: NodeJS.WritableStream, ev: SseEvent): void {
    if (handleCommonEvents(ev)) return
    const c = parseJson(ev.data)
    switch (ev.name) {
      case 'message':
      case 'agent_message': {
        if (typeof c.answer === 'string') this.filter.push(c.answer, out, errOut)
        if (typeof c.conversation_id === 'string' && c.conversation_id !== '')
          this.convoId = c.conversation_id
        return
      }
      // Stream separated-mode reasoning to stderr under --think.
      case 'reasoning_chunk': {
        if (!this.think) return
        const chunk = parseReasoningChunk(c)
        if (chunk !== undefined) this.reasoning.push(chunk, errOut)
        return
      }
      case 'agent_thought':
        if (typeof c.thought === 'string' && c.thought !== '')
          errOut.write(`thought: ${c.thought}\n`)
        return
      case 'message_end':
        if (typeof c.conversation_id === 'string' && c.conversation_id !== '')
          this.convoId = c.conversation_id
    }
  }

  onEnd(out: NodeJS.WritableStream, errOut: NodeJS.WritableStream): void {
    this.reasoning.flush(errOut)
    this.filter.flush(out, errOut)
    out.write('\n')
    if (this.convoId !== '') {
      const cs = colorScheme(colorEnabled(this.isTTY))
      errOut.write(
        `${cs.magenta('hint:')} continue this conversation with --conversation ${cs.cyan(this.convoId)}\n`,
      )
    }
  }
}

class CompletionStreamPrinter implements StreamPrinter {
  private readonly filter: ThinkChunkFilter
  constructor(think: boolean) {
    this.filter = new ThinkChunkFilter(think)
  }

  onEvent(out: NodeJS.WritableStream, errOut: NodeJS.WritableStream, ev: SseEvent): void {
    if (handleCommonEvents(ev)) return
    if (ev.name !== 'message') return
    const c = parseJson(ev.data)
    if (typeof c.answer === 'string') this.filter.push(c.answer, out, errOut)
  }

  onEnd(out: NodeJS.WritableStream, errOut: NodeJS.WritableStream): void {
    this.filter.flush(out, errOut)
    out.write('\n')
  }
}

class WorkflowStreamPrinter implements StreamPrinter {
  private final: Record<string, unknown> | undefined
  private readonly reasoning = new ReasoningChunkRenderer()
  private readonly think: boolean
  constructor(think: boolean) {
    this.think = think
  }

  onEvent(_out: NodeJS.WritableStream, errOut: NodeJS.WritableStream, ev: SseEvent): void {
    if (handleCommonEvents(ev)) return
    const c = parseJson(ev.data)
    switch (ev.name) {
      case 'node_started': {
        const title =
          typeof c.title === 'string' && c.title !== ''
            ? c.title
            : typeof c.id === 'string'
              ? c.id
              : ''
        if (title !== '') errOut.write(`→ ${title}\n`)
        return
      }
      // Stream separated-mode reasoning to stderr under --think; the prior → title attributes the node.
      case 'reasoning_chunk': {
        if (!this.think) return
        const chunk = parseReasoningChunk(c)
        if (chunk !== undefined) this.reasoning.push(chunk, errOut)
        return
      }
      case 'node_finished': {
        const status = typeof c.status === 'string' ? c.status : ''
        if (status !== '' && status !== 'succeeded') {
          const id = typeof c.id === 'string' ? c.id : ''
          errOut.write(`  [${status}] ${id}\n`)
        }
        return
      }
      case 'workflow_finished':
        this.final = c
    }
  }

  onEnd(out: NodeJS.WritableStream, errOut: NodeJS.WritableStream): void {
    this.reasoning.flush(errOut)
    if (this.final === undefined) return
    const data = this.final.data
    if (data !== null && typeof data === 'object' && 'outputs' in data) {
      const raw = (data as { outputs: unknown }).outputs
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        const { outputs, thinking } = filterThinkInOutputs(
          raw as Record<string, unknown>,
          this.think,
        )
        if (this.think && thinking !== '') errOut.write(`${thinking}\n`)
        out.write(`${JSON.stringify(outputs)}\n`)
        return
      }
      out.write(`${JSON.stringify(raw)}\n`)
      return
    }
    out.write(`${JSON.stringify(this.final)}\n`)
  }
}

const FACTORIES: Record<string, (think: boolean, isTTY: boolean) => StreamPrinter> = {
  [RUN_MODES.Chat]: (think, isTTY) => new ChatStreamPrinter(think, isTTY),
  [RUN_MODES.AdvancedChat]: (think, isTTY) => new ChatStreamPrinter(think, isTTY),
  [RUN_MODES.AgentChat]: (think, isTTY) => new ChatStreamPrinter(think, isTTY),
  [RUN_MODES.Completion]: (think, _isTTY) => new CompletionStreamPrinter(think),
  [RUN_MODES.Workflow]: (think, _isTTY) => new WorkflowStreamPrinter(think),
}

export function streamPrinterFor(mode: string, think = false, isTTY = false): StreamPrinter {
  const f = FACTORIES[mode]
  if (f === undefined) throw newError(ErrorCode.Unknown, `unsupported streaming mode "${mode}"`)
  return f(think, isTTY)
}
