import type { SseEvent } from '../../../../http/sse.js'
import type { RunContext, RunStrategy } from './index.js'
import { buildRunBody } from '../../../../api/app-run.js'
import { colorEnabled, colorScheme } from '../../../../sys/io/color.js'
import { startSpinner } from '../../../../sys/io/spinner.js'
import { extractThinkBlocks, stripThinkBlocks } from '../../../../sys/io/think-filter.js'
import { chatConversationHint, newAppRunObject, RUN_MODES } from '../handlers.js'
import { renderHitlHint, renderHitlOutput } from '../hitl-render.js'
import { collect, HitlPauseError } from '../sse-collector.js'

const CHAT_MODES: ReadonlySet<string> = new Set([RUN_MODES.Chat, RUN_MODES.AgentChat, RUN_MODES.AdvancedChat])

async function* captureTaskId(
  iter: AsyncIterable<SseEvent>,
  onCapture: (id: string) => void,
): AsyncIterable<SseEvent> {
  const dec = new TextDecoder()
  for await (const ev of iter) {
    if (ev.data.byteLength > 0) {
      try {
        const parsed = JSON.parse(dec.decode(ev.data)) as Record<string, unknown>
        if (typeof parsed.task_id === 'string' && parsed.task_id !== '')
          onCapture(parsed.task_id)
      }
      catch { /* ignore parse errors */ }
    }
    yield ev
  }
}

export class StreamingStructuredStrategy implements RunStrategy {
  async execute(ctx: RunContext): Promise<void> {
    const { opts, deps, mode, format, isText, printFlags, exit } = ctx
    const ctrl = new AbortController()
    const body = buildRunBody({
      message: opts.message,
      inputs: opts.inputs as Record<string, unknown>,
      conversationId: opts.conversationId,
      workspaceId: opts.workspace,
      workflowId: opts.workflowId,
    })

    const spinner = startSpinner({ io: deps.io, label: 'running', enabled: ctx.isText && !ctx.livePrint })

    let taskId: string | undefined
    const cleanup = () => {
      spinner.stop()
      if (taskId !== undefined)
        void ctx.runClient.stopTask(opts.appId, taskId).catch(() => {})
      ctrl.abort()
      exit(1)
    }
    process.once('SIGINT', cleanup)

    let resp: Record<string, unknown>
    try {
      const events = await ctx.runClient.runStream(opts.appId, body, { signal: ctrl.signal })
      const wrappedEvents = captureTaskId(events, (id) => {
        taskId = id
      })
      resp = await collect(wrappedEvents, mode)
    }
    catch (err) {
      ctrl.abort()
      if (err instanceof HitlPauseError) {
        spinner.stop()
        deps.io.out.write(renderHitlOutput(opts.appId, err.pausePayload, isText, deps.io.isOutTTY))
        deps.io.err.write(renderHitlHint(opts.appId, err.pausePayload, deps.io.isErrTTY))
        exit(0)
      }
      throw err
    }
    finally {
      spinner.stop()
      process.off('SIGINT', cleanup)
    }
    let processedResp = resp
    if (typeof processedResp.answer === 'string') {
      if (ctx.think) {
        const { clean, thinking } = extractThinkBlocks(processedResp.answer)
        if (thinking !== '')
          deps.io.err.write(`${thinking}\n`)
        processedResp = { ...processedResp, answer: clean }
      }
      else {
        processedResp = { ...processedResp, answer: stripThinkBlocks(processedResp.answer) }
      }
    }

    const respMode = typeof processedResp.mode === 'string' && processedResp.mode !== '' ? processedResp.mode : mode
    deps.io.out.write(printFlags.toPrinter(format).print(newAppRunObject(respMode, processedResp)))
    if (isText && CHAT_MODES.has(respMode)) {
      const cs = colorScheme(colorEnabled(deps.io.isErrTTY))
      const hint = chatConversationHint(processedResp, cs)
      if (hint !== undefined)
        deps.io.err.write(hint)
    }
  }
}
