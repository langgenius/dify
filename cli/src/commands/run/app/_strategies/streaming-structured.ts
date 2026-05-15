import type { SseEvent } from '../../../../http/sse.js'
import type { HitlPausePayload } from '../sse-collector.js'
import type { RunContext, RunStrategy } from './index.js'
import { buildRunBody } from '../../../../api/app-run.js'
import { chatConversationHint, newAppRunObject, RUN_MODES } from '../handlers.js'
import { collect, HitlPauseError } from '../sse-collector.js'

const CHAT_MODES: ReadonlySet<string> = new Set([RUN_MODES.Chat, RUN_MODES.AgentChat, RUN_MODES.AdvancedChat])

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

    let taskId: string | undefined
    const cleanup = () => {
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
        deps.io.out.write(`${buildHitlExitJson(opts.appId, err.pausePayload)}\n`)
        deps.io.err.write(hitlResumeHint(opts.appId, err.pausePayload))
        exit(2)
      }
      throw err
    }
    finally {
      process.off('SIGINT', cleanup)
    }
    const respMode = typeof resp.mode === 'string' && resp.mode !== '' ? resp.mode : mode
    deps.io.out.write(printFlags.toPrinter(format).print(newAppRunObject(respMode, resp)))
    if (isText && CHAT_MODES.has(respMode)) {
      const hint = chatConversationHint(resp)
      if (hint !== undefined)
        deps.io.err.write(hint)
    }
  }
}
