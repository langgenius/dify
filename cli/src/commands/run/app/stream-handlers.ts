import type { SseEvent } from '../../../http/sse.js'
import type { StreamPrinter } from '../../../printers/stream-printer.js'
import type { HitlPausePayload } from './sse-collector.js'
import { newError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { RUN_MODES } from './handlers.js'
import { HitlPauseError } from './sse-collector.js'

const dec = new TextDecoder()

function parseJson(data: Uint8Array): Record<string, unknown> {
  if (data.byteLength === 0)
    return {}
  try {
    return JSON.parse(dec.decode(data)) as Record<string, unknown>
  }
  catch {
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
  if (SILENT_EVENTS.has(ev.name))
    return true
  if (ev.name === 'human_input_required') {
    throw new HitlPauseError(parseJson(ev.data) as unknown as HitlPausePayload)
  }
  return false
}

class ChatStreamPrinter implements StreamPrinter {
  private convoId = ''
  onEvent(out: NodeJS.WritableStream, errOut: NodeJS.WritableStream, ev: SseEvent): void {
    if (handleCommonEvents(ev))
      return
    const c = parseJson(ev.data)
    switch (ev.name) {
      case 'message':
      case 'agent_message': {
        if (typeof c.answer === 'string')
          out.write(c.answer)
        if (typeof c.conversation_id === 'string' && c.conversation_id !== '')
          this.convoId = c.conversation_id
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
    out.write('\n')
    if (this.convoId !== '')
      errOut.write(`hint: continue this conversation with --conversation ${this.convoId}\n`)
  }
}

class CompletionStreamPrinter implements StreamPrinter {
  onEvent(out: NodeJS.WritableStream, _errOut: NodeJS.WritableStream, ev: SseEvent): void {
    if (handleCommonEvents(ev))
      return
    if (ev.name !== 'message')
      return
    const c = parseJson(ev.data)
    if (typeof c.answer === 'string')
      out.write(c.answer)
  }

  onEnd(out: NodeJS.WritableStream): void {
    out.write('\n')
  }
}

class WorkflowStreamPrinter implements StreamPrinter {
  private final: Record<string, unknown> | undefined
  onEvent(_out: NodeJS.WritableStream, errOut: NodeJS.WritableStream, ev: SseEvent): void {
    if (handleCommonEvents(ev))
      return
    const c = parseJson(ev.data)
    switch (ev.name) {
      case 'node_started': {
        const title = (typeof c.title === 'string' && c.title !== '')
          ? c.title
          : (typeof c.id === 'string' ? c.id : '')
        if (title !== '')
          errOut.write(`→ ${title}\n`)
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

  onEnd(out: NodeJS.WritableStream): void {
    if (this.final === undefined)
      return
    const data = this.final.data
    if (data !== null && typeof data === 'object' && 'outputs' in data) {
      out.write(`${JSON.stringify((data as { outputs: unknown }).outputs)}\n`)
      return
    }
    out.write(`${JSON.stringify(this.final)}\n`)
  }
}

const FACTORIES: Record<string, () => StreamPrinter> = {
  [RUN_MODES.Chat]: () => new ChatStreamPrinter(),
  [RUN_MODES.AdvancedChat]: () => new ChatStreamPrinter(),
  [RUN_MODES.AgentChat]: () => new ChatStreamPrinter(),
  [RUN_MODES.Completion]: () => new CompletionStreamPrinter(),
  [RUN_MODES.Workflow]: () => new WorkflowStreamPrinter(),
}

export function streamPrinterFor(mode: string): StreamPrinter {
  const f = FACTORIES[mode]
  if (f === undefined)
    throw newError(ErrorCode.Unknown, `unsupported streaming mode "${mode}"`)
  return f()
}
