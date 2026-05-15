import type { HitlPausePayload } from '../sse-collector.js'
import type { RunContext, RunStrategy } from './index.js'
import { buildRunBody } from '../../../../api/app-run.js'
import { decodeStreamError, HitlPauseError } from '../sse-collector.js'

function buildHitlExitJson(appId: string, payload: HitlPausePayload): string {
  return JSON.stringify({
    status: 'paused',
    app_id: appId,
    task_id: payload.task_id,
    workflow_run_id: payload.workflow_run_id,
    form_token: payload.form_token,
    form_content: payload.form_content,
    inputs: payload.inputs,
    resolved_default_values: payload.resolved_default_values,
    user_actions: payload.user_actions,
    expiration_time: payload.expiration_time,
  })
}

function hitlResumeHint(appId: string, payload: HitlPausePayload): string {
  let hint = `hint: workflow paused — resume with: difyctl run app resume ${appId} ${payload.form_token} --workflow-run-id ${payload.workflow_run_id}`
  const actions = payload.user_actions as { id: string }[]
  if (actions.length > 1) {
    const firstAction = actions[0]?.id
    if (firstAction !== undefined)
      hint += ` --action ${firstAction}`
  }
  return `${hint}\n`
}

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
    process.once('SIGINT', cleanup)

    try {
      const events = await ctx.runClient.runStream(opts.appId, body, { signal: ctrl.signal })
      const sp = printFlags.toStreamPrinter(mode)
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
            deps.io.out.write(`${buildHitlExitJson(opts.appId, err.pausePayload)}\n`)
            deps.io.err.write(hitlResumeHint(opts.appId, err.pausePayload))
            exit(2)
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
      process.off('SIGINT', cleanup)
    }
  }
}
