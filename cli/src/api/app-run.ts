import type { OpenApiClient } from '@/http/orpc'
import type { SseEvent } from '@/http/sse'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'
import { parseSSE } from '@/http/sse'
import { normalizeDifyStream } from '@/http/sse-dify'

export type RunBodyArgs = {
  readonly message?: string
  readonly inputs?: Readonly<Record<string, unknown>>
  readonly conversationId?: string
  readonly workspaceId?: string
  readonly workflowId?: string
  readonly files?: readonly Record<string, unknown>[]
}

export function buildRunBody(args: RunBodyArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    inputs: args.inputs ?? {},
  }
  if (args.message !== undefined && args.message !== '') body.query = args.message
  if (args.conversationId !== undefined && args.conversationId !== '')
    body.conversation_id = args.conversationId
  if (args.workspaceId !== undefined && args.workspaceId !== '')
    body.workspace_id = args.workspaceId
  if (args.workflowId !== undefined && args.workflowId !== '') body.workflow_id = args.workflowId
  if (args.files !== undefined && args.files.length > 0) body.files = args.files
  return body
}

export type StreamOptions = {
  signal?: AbortSignal
  includeStateSnapshot?: boolean
  retryOnRateLimit?: boolean
}

export class AppRunClient {
  private readonly http: HttpClient
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.http = http
    // Mixed class (SPEC §4.4): runStream / reconnectStream are SSE and stay on the raw
    // `http.stream` facade; stopTask / submitHumanInput are plain JSON and go through the
    // generated oRPC contract. Both facades share this one transport.
    this.orpc = createOpenApiClient(http)
  }

  async runStream(
    appId: string,
    body: Record<string, unknown>,
    opts: StreamOptions = {},
  ): Promise<AsyncIterable<SseEvent>> {
    const res = await this.http.stream(`apps/${encodeURIComponent(appId)}:run`, {
      method: 'POST',
      json: body,
      headers: { Accept: 'text/event-stream' },
      signal: opts.signal,
      throwOnError: true,
      retryOnRateLimit: opts.retryOnRateLimit,
    })
    if (res.body === null) throw new Error('streaming response body missing')
    return normalizeDifyStream(parseSSE(res.body, opts.signal))
  }

  async stopTask(appId: string, taskId: string): Promise<void> {
    await this.orpc.apps.byAppId.tasks.byTaskId.stop.post({
      params: { app_id: appId, task_id: taskId },
    })
  }

  async submitHumanInput(
    appId: string,
    formToken: string,
    action: string,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    await this.orpc.apps.byAppId.humanInputForms.byFormToken.submit.post({
      params: { app_id: appId, form_token: formToken },
      body: { action, inputs },
    })
  }

  async reconnectStream(
    appId: string,
    workflowRunId: string,
    opts: StreamOptions = {},
  ): Promise<AsyncIterable<SseEvent>> {
    const url = `apps/${encodeURIComponent(appId)}/tasks/${encodeURIComponent(workflowRunId)}/events`
    const res = await this.http.stream(url, {
      searchParams: {
        include_state_snapshot: opts.includeStateSnapshot === true ? 'true' : 'false',
        continue_on_pause: 'false',
      },
      headers: { Accept: 'text/event-stream' },
      signal: opts.signal,
      throwOnError: true,
    })
    if (res.body === null) throw new Error('reconnect stream body missing')
    return normalizeDifyStream(parseSSE(res.body, opts.signal))
  }
}
