import type { SseEvent } from '@/http/sse'
import type { HttpClient } from '@/http/types'
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
  if (args.message !== undefined && args.message !== '')
    body.query = args.message
  if (args.conversationId !== undefined && args.conversationId !== '')
    body.conversation_id = args.conversationId
  if (args.workspaceId !== undefined && args.workspaceId !== '')
    body.workspace_id = args.workspaceId
  if (args.workflowId !== undefined && args.workflowId !== '')
    body.workflow_id = args.workflowId
  if (args.files !== undefined && args.files.length > 0)
    body.files = args.files
  return body
}

export type StreamOptions = {
  signal?: AbortSignal
  includeStateSnapshot?: boolean
}

export class AppRunClient {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async runStream(
    appId: string,
    body: Record<string, unknown>,
    opts: StreamOptions = {},
  ): Promise<AsyncIterable<SseEvent>> {
    const res = await this.http.stream(`apps/${encodeURIComponent(appId)}/run`, {
      method: 'POST',
      json: body,
      headers: { Accept: 'text/event-stream' },
      signal: opts.signal,
      throwOnError: true,
    })
    if (res.body === null)
      throw new Error('streaming response body missing')
    return normalizeDifyStream(parseSSE(res.body, opts.signal))
  }

  async stopTask(appId: string, taskId: string): Promise<void> {
    await this.http.post(`apps/${encodeURIComponent(appId)}/tasks/${encodeURIComponent(taskId)}/stop`, {
      json: {},
      timeoutMs: 30_000,
    })
  }

  async submitHumanInput(
    appId: string,
    formToken: string,
    action: string,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    await this.http.post(
      `apps/${encodeURIComponent(appId)}/form/human_input/${encodeURIComponent(formToken)}`,
      { json: { action, inputs }, timeoutMs: 30_000 },
    )
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
    if (res.body === null)
      throw new Error('reconnect stream body missing')
    return normalizeDifyStream(parseSSE(res.body, opts.signal))
  }
}
