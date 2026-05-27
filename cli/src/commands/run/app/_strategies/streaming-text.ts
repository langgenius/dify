import type { RunContext, RunStrategy } from './index.js'
import { buildRunBody } from '../../../../api/app-run.js'
import { handle, unhandle } from '../../../../sys/index.js'
import { renderHitlHint, renderHitlOutput } from '../hitl-render.js'
import { decodeStreamError, HitlPauseError } from '../sse-collector.js'

export class StreamingTextStrategy implements RunStrategy {
  async execute(ctx: RunContext): Promise<void> {
    const { opts, deps, mode, printFlags, exit } = ctx
    const ctrl = new AbortController()
    const body = buildRunBody({
      message: opts.message,
      inputs: opts.inputs as Record<string, unknown>,
      conversationId: opts.conversationId,
      workspaceId: opts.workspace,
      workflowId: opts.workflowId,
    })

    let taskId: string | undefined
    const cleanup = () => {
      if (taskId !== undefined)
        void ctx.runClient.stopTask(opts.appId, taskId).catch(() => {})
      ctrl.abort()
      exit(1)
    }

    handle('SIGINT', cleanup)

    try {
      const events = await ctx.runClient.runStream(opts.appId, body, { signal: ctrl.signal })
      const sp = printFlags.toStreamPrinter(mode, ctx.think, deps.io.isErrTTY)
      const dec = new TextDecoder()
      for await (const ev of events) {
        if (ev.name === 'ping')
          continue
        if (ev.name === 'error')
          throw decodeStreamError(ev.data)
        if (ev.data.byteLength > 0) {
          try {
            const parsed = JSON.parse(dec.decode(ev.data)) as Record<string, unknown>
            if (typeof parsed.task_id === 'string' && parsed.task_id !== '' && taskId === undefined)
              taskId = parsed.task_id
          }
          catch { /* ignore */ }
        }
        try {
          sp.onEvent(deps.io.out, deps.io.err, ev)
        }
        catch (err) {
          if (err instanceof HitlPauseError) {
            deps.io.out.write(renderHitlOutput(opts.appId, err.pausePayload, ctx.isText, deps.io.isOutTTY))
            deps.io.err.write(renderHitlHint(opts.appId, err.pausePayload, deps.io.isErrTTY))
            exit(0)
          }
          throw err
        }
      }
      sp.onEnd(deps.io.out, deps.io.err)
    }
    catch (err) {
      ctrl.abort()
      throw err
    }
    finally {
      unhandle('SIGINT', cleanup)
    }
  }
}
