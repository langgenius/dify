import type { OpenApiClient } from '@/http/orpc'
import type { SseEvent } from '@/http/sse'
import type { HttpClient } from '@/http/types'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { requestCatalogOperation } from '@/http/catalog'
import { createOpenApiClient } from '@/http/orpc'
import { parseSSE } from '@/http/sse'
import { normalizeDifyStream } from '@/http/sse-dify'
import { AppsClient } from './apps'

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
  mode?: string
  signal?: AbortSignal
  includeStateSnapshot?: boolean
  retryOnRateLimit?: boolean
}

export class AppRunClient {
  private readonly http: HttpClient
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.http = http
    // SSE and unary operations share catalog negotiation and the same HTTP transport.
    this.orpc = createOpenApiClient(http)
  }

  async runStream(
    appId: string,
    body: Record<string, unknown>,
    opts: StreamOptions = {},
  ): Promise<AsyncIterable<SseEvent>> {
    const mode = opts.mode ?? (await new AppsClient(this.http).describe(appId, ['info'])).info?.mode
    const operation = {
      workflow: 'console_app.workflow.run',
      chat: 'console_app.chat.run',
      'agent-chat': 'console_app.chat.run',
      'advanced-chat': 'console_app.advanced_chat.run',
      completion: 'console_app.completion.run',
    }[mode ?? '']
    if (!operation)
      throw new BaseError({ code: ErrorCode.VersionSkew, message: `Unsupported app mode: ${mode}` })
    const res = await requestCatalogOperation(
      this.http,
      operation,
      { ...body, app_id: appId },
      {
        stream: true,
        headers: { Accept: 'text/event-stream' },
        signal: opts.signal,
        retryOnRateLimit: opts.retryOnRateLimit,
      },
    )
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
    const res = await requestCatalogOperation(
      this.http,
      'run.events',
      {
        app_id: appId,
        task_id: workflowRunId,
        include_state_snapshot: opts.includeStateSnapshot === true,
        continue_on_pause: false,
      },
      {
        stream: true,
        headers: { Accept: 'text/event-stream' },
        signal: opts.signal,
      },
    )
    if (res.body === null) throw new Error('reconnect stream body missing')
    return normalizeDifyStream(parseSSE(res.body, opts.signal))
  }
}
