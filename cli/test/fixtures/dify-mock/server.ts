import type { Context as HonoContext } from 'hono'
import type { ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppFixture, Scenario } from './scenarios.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response'
import { Hono } from 'hono'
import { matchedRoutes } from 'hono/route'
import { METHOD_NAME_ALL } from 'hono/router'
import { CATALOG_HEADER, CATALOG_PATH } from '@/plugins/catalog'
import { ACCOUNT, APPS, DSL_YAML, SESSIONS, WORKSPACES } from './scenarios.js'

export type DifyMockOptions = {
  scenario?: Scenario
  port?: number
}

export type LastRequest = Readonly<{
  method: string
  path: string
  headers: Record<string, string>
  contentType: string | null
}>

export type DifyMock = {
  url: string
  port: number
  scenario: Scenario
  setScenario: (s: Scenario) => void
  stop: () => Promise<void>
  /** Body of the most recent POST to a run route */
  lastRunBody: Record<string, unknown> | null
  /** Multipart parts of the most recent POST to a run route, keyed by part name as received */
  lastRunParts: Record<string, string | File[]> | null
  /** Number of times POST /apps/:id/files was called */
  uploadCallCount: number
  /** Body of the most recent POST to /workspaces/:id/apps/imports */
  lastImportBody: Record<string, unknown> | null
  /** Method, path (with query string), headers and content-type of the most recent request */
  lastRequest: LastRequest | null
  /** Number of requests received, including GET _catalog */
  requestCount: number
}

const TOKEN_RE = /^Bearer\s+dfo[ae]_[\w-]+$/
const VERSION_PATH = '/openapi/v1/_version'
const HANG_PATH = '/hang'
const EMPTY_ERROR_PATH = '/empty-error'
const BAD_VERIFICATION_URI = 'ftp://elsewhere.example/device'
const HANG_MS = 30_000
const OAUTH_PREFIX = '/openapi/v1/oauth/'

const ServerErrorCode = {
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  RateLimited: 'rate_limited',
  Server5xx: 'server_5xx',
  NotFound: 'not_found',
  CatalogStale: 'catalog_stale',
  ValidationError: 'validation_error',
} as const

const OpId = {
  AppList: 'console_app.list',
  WorkspaceList: 'workspace.list',
  AccountSessionsList: 'account.sessions.list',
  ChatRun: 'console_app.chat.run',
  AdvancedChatRun: 'console_app.advanced_chat.run',
  FormSubmit: 'run.form.submit',
} as const

const CATALOG_STALE_MESSAGE =
  "The request was built from a catalog that is not this server's current catalog."
const CATALOG_STALE_HINT =
  'GET /openapi/v1/_catalog, rebuild the request from it, and send its sha256 in X-Dify-Catalog.'

type MockErrorBody = { code: string; message: string; status: number; hint?: string }

function errorBody(code: string, message: string, status: number, hint?: string): MockErrorBody {
  return hint === undefined ? { code, message, status } : { code, message, status, hint }
}

function errorResponse(code: string, message: string, status: number, hint?: string) {
  return Response.json(errorBody(code, message, status, hint), { status })
}

function unauthorized() {
  return errorResponse(ServerErrorCode.Unauthorized, 'invalid or expired token', 401)
}

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const CATALOG_BYTES = readFileSync(join(FIXTURE_DIR, '..', 'catalog.json'))
const CATALOG_V2_BYTES = readFileSync(join(FIXTURE_DIR, '..', 'catalog-v2.json'))
const CATALOG_FINGERPRINT = createHash('sha256').update(CATALOG_BYTES).digest('hex')
const CATALOG_V2_FINGERPRINT = createHash('sha256').update(CATALOG_V2_BYTES).digest('hex')

function catalogBytesFor(scenario: Scenario): Uint8Array | undefined {
  if (scenario === 'no-catalog') return undefined
  if (scenario === 'catalog-changed') return CATALOG_V2_BYTES
  return CATALOG_BYTES
}

function catalogFingerprintFor(scenario: Scenario): string {
  return scenario === 'catalog-changed' ? CATALOG_V2_FINGERPRINT : CATALOG_FINGERPRINT
}

function sseChunks(events: { event: string; data: Record<string, unknown> }[]): string {
  return events.map((e) => `data: ${JSON.stringify({ ...e.data, event: e.event })}\n\n`).join('')
}

function chatReplyHints(mode: string, appId: string): Record<string, unknown>[] {
  const op =
    mode === 'chat' ? OpId.ChatRun : mode === 'advanced-chat' ? OpId.AdvancedChatRun : undefined
  if (op === undefined) return []
  return [
    {
      summary: 'Reply in this conversation',
      op,
      input: { app_id: appId, conversation_id: 'conv-1', query: null, inputs: {} },
    },
  ]
}

function nextPageHints(
  op: string,
  query: Record<string, string>,
  page: number,
  limit: number,
  hasMore: boolean,
): Record<string, unknown>[] {
  if (!hasMore) return []
  return [{ summary: 'Next page', op, input: { ...query, page: page + 1, limit } }]
}

function streamingRunResponse(
  mode: string,
  query: string,
  isAgent: boolean,
  appId: string,
): string {
  if (mode === 'workflow') {
    return sseChunks([
      { event: 'workflow_started', data: { id: 'wf-run-1', workflow_id: 'wf-1' } },
      { event: 'node_started', data: { id: 'n1', title: 'first' } },
      { event: 'node_finished', data: { id: 'n1', status: 'succeeded' } },
      {
        event: 'workflow_finished',
        data: {
          id: 'wf-run-1',
          workflow_id: 'wf-1',
          data: { id: 'wf-run-1', status: 'succeeded', outputs: { result: `echo: ${query}` } },
        },
      },
    ])
  }
  if (mode === 'completion') {
    return sseChunks([
      { event: 'message', data: { message_id: 'msg-1', mode, answer: 'echo: ' } },
      { event: 'message', data: { answer: query } },
      {
        event: 'message_end',
        data: {
          message_id: 'msg-1',
          task_id: 'task-1',
          metadata: {},
          hints: chatReplyHints(mode, appId),
        },
      },
    ])
  }
  const evt = isAgent ? 'agent_message' : 'message'
  const events: { event: string; data: Record<string, unknown> }[] = [
    {
      event: evt,
      data: { message_id: 'msg-1', conversation_id: 'conv-1', mode, answer: 'echo: ' },
    },
    { event: evt, data: { answer: query } },
  ]
  if (isAgent) events.push({ event: 'agent_thought', data: { thought: 'thinking…' } })
  events.push({
    event: 'message_end',
    data: {
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      metadata: {},
      hints: chatReplyHints(mode, appId),
    },
  })
  return sseChunks(events)
}

function hitlPauseResponse(appId: string): string {
  return sseChunks([
    { event: 'workflow_started', data: { id: 'wf-run-hitl-1', workflow_id: 'wf-1' } },
    { event: 'node_started', data: { id: 'n1', title: 'First Node' } },
    {
      event: 'human_input_required',
      data: {
        task_id: 'task-hitl-1',
        workflow_run_id: 'wf-run-hitl-1',
        data: {
          form_id: 'form-hitl-1',
          node_id: 'n1',
          node_title: 'First Node',
          form_content: 'Please provide input',
          inputs: [{ output_variable_name: 'name' }],
          actions: [{ id: 'submit', title: 'Submit' }],
          display_in_ui: false,
          form_token: 'ft-hitl-1',
          resolved_default_values: { name: 'Alice' },
          expiration_time: 9999999999,
        },
        hints: [
          {
            summary: 'Submit',
            op: OpId.FormSubmit,
            input: {
              app_id: appId,
              form_token: 'ft-hitl-1',
              action: 'submit',
              inputs: { name: null },
            },
            form: [{ output_variable_name: 'name' }],
          },
        ],
      },
    },
    { event: 'workflow_paused', data: { reasons: [] } },
  ])
}

function hitlResumedResponse(): string {
  return sseChunks([
    { event: 'node_started', data: { id: 'n2', title: 'After Resume' } },
    { event: 'node_finished', data: { id: 'n2', status: 'succeeded' } },
    {
      event: 'workflow_finished',
      data: {
        id: 'wf-run-hitl-1',
        workflow_id: 'wf-1',
        data: { id: 'wf-run-hitl-1', status: 'succeeded', outputs: { result: 'echo: resumed' } },
      },
    },
  ])
}

export type MockState = {
  lastRunBody: Record<string, unknown> | null
  lastRunParts: Record<string, string | File[]> | null
  uploadCallCount: number
  lastImportBody: Record<string, unknown> | null
  lastRequest: LastRequest | null
  requestCount: number
}

async function readMultipartRunBody(
  c: HonoContext,
): Promise<{ json: Record<string, unknown>; parts: Record<string, string | File[]> }> {
  const parsed = await c.req.parseBody({ all: true })
  const json: Record<string, unknown> = {}
  const parts: Record<string, string | File[]> = {}
  for (const [key, value] of Object.entries(parsed)) {
    const values = Array.isArray(value) ? value : [value]
    const files = values.filter((v): v is File => v instanceof File)
    if (files.length > 0) {
      parts[key] = files
      continue
    }
    const text = values[0] as string
    parts[key] = text
    json[key] = JSON.parse(text)
  }
  return { json, parts }
}

const SLOW_STREAM_GAP_MS = 200

function sseResponse(body: string | ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

// Headers land at once, the first event right after, and the rest only after a gap —
// the shape that a whole-request timeout would cut short but a headers deadline must not.
function slowStreamBody(query: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        enc.encode(
          sseChunks([{ event: 'message', data: { message_id: 'msg-1', answer: 'echo: ' } }]),
        ),
      )
      await new Promise((r) => setTimeout(r, SLOW_STREAM_GAP_MS))
      controller.enqueue(
        enc.encode(
          sseChunks([
            { event: 'message', data: { answer: query } },
            { event: 'message_end', data: { message_id: 'msg-1', metadata: {} } },
          ]),
        ),
      )
      controller.close()
    },
  })
}

// One good event, then the socket dies under the client: the body read rejects
// mid-stream, which an errored ReadableStream alone does not reproduce.
function destroyMidStream(c: HonoContext): Response {
  const { outgoing } = c.env as { outgoing: ServerResponse }
  outgoing.writeHead(200, { 'content-type': 'text/event-stream' })
  outgoing.write(
    sseChunks([{ event: 'message', data: { message_id: 'msg-1', answer: 'partial' } }]),
    () => outgoing.socket?.destroy(),
  )
  return RESPONSE_ALREADY_SENT
}

function runResponse(
  c: HonoContext,
  app: AppFixture,
  body: Record<string, unknown>,
  scenario: Scenario,
): Response {
  if (scenario === 'broken-stream') return destroyMidStream(c)
  const isAgent = app.is_agent === true || app.mode === 'agent-chat'
  const query = (body.query as string | undefined) ?? ''
  if (scenario === 'stream-error')
    return sseResponse(sseChunks([{ event: 'error', data: { message: 'boom', status: 503 } }]))
  if (scenario === 'slow-stream') return sseResponse(slowStreamBody(query))
  if (scenario === 'hitl-pause') return sseResponse(hitlPauseResponse(app.id))
  return sseResponse(streamingRunResponse(app.mode, query, isAgent, app.id))
}

async function handleRun(
  c: HonoContext,
  id: string,
  state: MockState | undefined,
  getScenario: () => Scenario,
): Promise<Response> {
  const contentType = c.req.header('content-type') ?? ''
  let body: Record<string, unknown>
  if (contentType.includes('multipart/form-data')) {
    const { json, parts } = await readMultipartRunBody(c)
    body = json
    if (state !== undefined) state.lastRunParts = parts
  } else {
    body = (await c.req.json()) as Record<string, unknown>
    if (state !== undefined) state.lastRunParts = null
  }
  if (state !== undefined) state.lastRunBody = body
  const app = APPS.find((a) => a.id === id)
  if (app === undefined) return errorResponse(ServerErrorCode.NotFound, 'app not found', 404)
  return runResponse(c, app, body, getScenario())
}

function recoverLegacyRunId(c: HonoContext): string {
  // Hono drops the param adjacent to the `:run` literal; recover the app id from the path.
  return c.req.path.replace(/^.*\/apps\//, '').replace(/:run$/, '')
}

export function buildApp(getScenario: () => Scenario, state?: MockState): Hono {
  const app = new Hono()

  app.use('*', async (c, next) => {
    if (state !== undefined) {
      state.requestCount++
      const url = new URL(c.req.url)
      state.lastRequest = {
        method: c.req.method,
        path: url.pathname + url.search,
        headers: Object.fromEntries(c.req.raw.headers.entries()),
        contentType: c.req.header('content-type') ?? null,
      }
    }
    await next()
  })

  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set(CATALOG_HEADER, catalogFingerprintFor(getScenario()))
  })

  app.notFound(() =>
    errorResponse(ServerErrorCode.NotFound, 'The requested URL was not found on the server.', 404),
  )

  app.get('/healthz', (c) => c.json({ ok: true }))

  // A rejection with no body at all: nothing for the client to name it by but the status.
  app.get(EMPTY_ERROR_PATH, () => new Response(null, { status: 503 }))

  // Accepts the connection and never answers: the headers deadline has to fire.
  // The timer is unref'd so it never holds the test process open.
  app.get(HANG_PATH, async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, HANG_MS).unref()
    })
    return new Response('too late', { status: 200 })
  })

  app.get(CATALOG_PATH, (_c) => {
    const bytes = catalogBytesFor(getScenario())
    if (bytes === undefined)
      return errorResponse(ServerErrorCode.NotFound, 'catalog not found', 404)
    return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } })
  })

  app.use('*', async (c, next) => {
    if (c.req.path === '/healthz') {
      await next()
      return
    }
    if (c.req.path.startsWith(OAUTH_PREFIX)) {
      await next()
      return
    }
    if (c.req.path === VERSION_PATH) {
      await next()
      return
    }
    const auth = c.req.header('Authorization') ?? ''
    if (!TOKEN_RE.test(auth)) return unauthorized()
    const scenario = getScenario()
    if (scenario === 'auth-expired') return unauthorized()
    await next()
  })

  app.get(VERSION_PATH, (c) => c.json({ version: '1.6.4', edition: 'CLOUD' }))

  app.use('*', async (c, next) => {
    const path = c.req.path
    if (!path.startsWith('/openapi/v1/')) {
      await next()
      return
    }
    if (path === CATALOG_PATH || path === VERSION_PATH || path.startsWith(OAUTH_PREFIX)) {
      await next()
      return
    }
    // Flask answers an unknown path 404 before any per-route guard runs.
    if (!matchedRoutes(c).some((route) => route.method !== METHOD_NAME_ALL)) {
      await next()
      return
    }
    const scenario = getScenario()
    const clientFingerprint = c.req.header(CATALOG_HEADER) ?? ''
    const serverFingerprint = catalogFingerprintFor(scenario)
    if (scenario === 'always-stale' || clientFingerprint !== serverFingerprint) {
      return errorResponse(
        ServerErrorCode.CatalogStale,
        CATALOG_STALE_MESSAGE,
        412,
        CATALOG_STALE_HINT,
      )
    }
    await next()
  })

  app.use('*', async (c, next) => {
    const scenario = getScenario()
    if (scenario === 'rate-limited') {
      // Per-token throttle (retryable); Retry-After advises the wait.
      return Response.json(
        errorBody(ServerErrorCode.RateLimited, 'Too many requests for this API token.', 429),
        { status: 429, headers: { 'retry-after': '1' } },
      )
    }
    if (scenario === 'server-5xx') {
      return errorResponse(ServerErrorCode.Server5xx, 'upstream broken', 503)
    }
    await next()
  })

  app.get('/openapi/v1/account', (c) => {
    const scenario = getScenario()
    if (scenario === 'sso') {
      return c.json({
        subject_type: 'external_sso',
        subject_email: 'sso@dify.ai',
        subject_issuer: 'https://issuer.example',
        account: null,
        workspaces: [],
        default_workspace_id: null,
      })
    }
    return c.json({
      subject_type: 'account',
      subject_email: ACCOUNT.email,
      account: { id: ACCOUNT.id, email: ACCOUNT.email, name: ACCOUNT.name },
      workspaces: WORKSPACES.map((w) => ({ id: w.id, name: w.name, role: w.role })),
      default_workspace_id: ACCOUNT.current_workspace_id,
    })
  })

  app.get('/openapi/v1/account/sessions', (c) => {
    const page = Number(c.req.query('page') ?? '1')
    const limit = Number(c.req.query('limit') ?? '100')
    const total = SESSIONS.length
    const start = (page - 1) * limit
    const slice = SESSIONS.slice(start, start + limit)
    const hasMore = page * limit < total
    return c.json({
      page,
      limit,
      total,
      has_more: hasMore,
      data: slice,
      hints: nextPageHints(OpId.AccountSessionsList, c.req.query(), page, limit, hasMore),
    })
  })

  app.delete('/openapi/v1/account/sessions/self', () =>
    Response.json({ status: 'revoked' }, { status: 200 }),
  )

  app.delete('/openapi/v1/account/sessions/:id', (c) => {
    const id = c.req.param('id')
    if (!SESSIONS.some((s) => s.id === id))
      return errorResponse(ServerErrorCode.NotFound, 'session not found', 404)
    return Response.json({ status: 'revoked' }, { status: 200 })
  })

  app.get('/openapi/v1/workspaces', (c) => {
    // A server that answers the list op with something other than a list envelope.
    if (getScenario() === 'workspaces-malformed') return c.json({ data: { id: 'ws-1' } })
    const page = Number(c.req.query('page') ?? '1')
    const limit = Number(c.req.query('limit') ?? '20')
    const rows =
      getScenario() === 'sso'
        ? []
        : WORKSPACES.map((w) => ({
            id: w.id,
            name: w.name,
            role: w.role,
            status: w.status,
            current: w.is_current,
          }))
    const total = rows.length
    const hasMore = page * limit < total
    return c.json({
      page,
      limit,
      total,
      has_more: hasMore,
      data: rows.slice((page - 1) * limit, page * limit),
      hints: nextPageHints(OpId.WorkspaceList, c.req.query(), page, limit, hasMore),
    })
  })

  // Reachable only under the `catalog-changed` scenario: the op that catalog v2 adds.
  app.get('/openapi/v1/workspaces/:wsId/ping', (c) => c.json({ ok: true }))

  app.get('/openapi/v1/apps', (c) => {
    const page = Number(c.req.query('page') ?? '1')
    const limit = Number(c.req.query('limit') ?? '20')
    const mode = c.req.query('mode')
    const tag = c.req.query('tag')
    const name = c.req.query('name')
    const workspaceId = c.req.query('workspace_id') ?? ACCOUNT.current_workspace_id
    let filtered = APPS.filter((a) => a.workspace_id === workspaceId)
    if (mode !== undefined && mode !== '') filtered = filtered.filter((a) => a.mode === mode)
    if (tag !== undefined && tag !== '')
      filtered = filtered.filter((a) => a.tags.some((t) => t.name === tag))
    if (name !== undefined && name !== '') filtered = filtered.filter((a) => a.name.includes(name))
    const total = filtered.length
    const start = (page - 1) * limit
    const slice = filtered.slice(start, start + limit)
    const hasMore = page * limit < total
    return c.json({
      page,
      limit,
      total,
      has_more: hasMore,
      data: slice,
      hints: nextPageHints(OpId.AppList, c.req.query(), page, limit, hasMore),
    })
  })

  app.get('/openapi/v1/apps/:id', (c) => {
    const id = c.req.param('id')
    const wsId = c.req.query('workspace_id')
    const fieldsRaw = c.req.query('fields') ?? ''
    const fields =
      fieldsRaw === ''
        ? []
        : fieldsRaw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '')
    const app = APPS.find(
      (a) => a.id === id && (wsId === undefined || wsId === '' || a.workspace_id === wsId),
    )
    if (app === undefined) return errorResponse(ServerErrorCode.NotFound, 'app not found', 404)
    const wantInfo = fields.length === 0 || fields.includes('info')
    const wantParams = fields.length === 0 || fields.includes('parameters')
    const wantInputSchema = fields.length === 0 || fields.includes('input_schema')
    return c.json({
      info: wantInfo
        ? {
            id: app.id,
            name: app.name,
            description: app.description,
            mode: app.mode,
            updated_at: app.updated_at,
            service_api_enabled: app.service_api_enabled ?? false,
            is_agent: app.is_agent ?? false,
          }
        : null,
      parameters: wantParams ? (app.parameters ?? null) : null,
      input_schema: wantInputSchema ? (app.input_schema ?? null) : null,
    })
  })

  app.get('/openapi/v1/permitted-external-apps/:id', (c) => {
    const id = c.req.param('id')
    const fieldsRaw = c.req.query('fields') ?? ''
    const fields =
      fieldsRaw === ''
        ? []
        : fieldsRaw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '')
    // External subjects have no workspace scope; the app is reachable across workspaces.
    const app = APPS.find((a) => a.id === id)
    if (app === undefined) return errorResponse(ServerErrorCode.NotFound, 'app not found', 404)
    const wantInfo = fields.length === 0 || fields.includes('info')
    const wantParams = fields.length === 0 || fields.includes('parameters')
    const wantInputSchema = fields.length === 0 || fields.includes('input_schema')
    return c.json({
      info: wantInfo
        ? {
            id: app.id,
            name: app.name,
            description: app.description,
            mode: app.mode,
            updated_at: app.updated_at,
            service_api_enabled: app.service_api_enabled ?? false,
            is_agent: app.is_agent ?? false,
          }
        : null,
      parameters: wantParams ? (app.parameters ?? null) : null,
      input_schema: wantInputSchema ? (app.input_schema ?? null) : null,
    })
  })

  app.get('/openapi/v1/apps/:id/dsl', (c) => {
    const id = c.req.param('id')
    const found = APPS.find((a) => a.id === id)
    if (found === undefined) return errorResponse(ServerErrorCode.NotFound, 'app not found', 404)
    return c.json({ data: DSL_YAML })
  })

  app.get('/openapi/v1/apps/:id/dependencies:check', (c) => {
    const id = c.req.param('id')
    const found = APPS.find((a) => a.id === id)
    if (found === undefined) return errorResponse(ServerErrorCode.NotFound, 'app not found', 404)
    return c.json({ leaked_dependencies: [] })
  })

  app.post('/openapi/v1/workspaces/:wsId/apps/imports', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>
    if (state !== undefined) state.lastImportBody = body
    const scenario = getScenario()
    if (scenario === 'import-failed')
      return c.json(
        { id: 'imp-1', status: 'failed', error: 'unsupported DSL version' },
        { status: 200 },
      )
    if (scenario === 'import-pending')
      return c.json(
        {
          id: 'imp-1',
          status: 'pending',
          current_dsl_version: '0.1.4',
          imported_dsl_version: '0.0.9',
        },
        { status: 202 },
      )
    return c.json(
      { id: 'imp-1', status: 'completed', app_id: 'app-1', app_mode: 'chat' },
      { status: 200 },
    )
  })

  app.post('/openapi/v1/workspaces/:wsId/apps/imports/:importId:confirm', (c) => {
    return c.json(
      { id: 'imp-1', status: 'completed', app_id: 'app-1', app_mode: 'chat' },
      { status: 200 },
    )
  })

  app.post('/openapi/v1/apps/:id:run', (c) =>
    handleRun(c, recoverLegacyRunId(c), state, getScenario),
  )
  app.post('/openapi/v1/apps/:id/workflow:run', (c) =>
    handleRun(c, c.req.param('id'), state, getScenario),
  )
  app.post('/openapi/v1/apps/:id/chat:run', (c) =>
    handleRun(c, c.req.param('id'), state, getScenario),
  )
  app.post('/openapi/v1/apps/:id/completion:run', (c) =>
    handleRun(c, c.req.param('id'), state, getScenario),
  )
  app.post('/openapi/v1/apps/:id/advanced-chat:run', (c) =>
    handleRun(c, c.req.param('id'), state, getScenario),
  )

  app.post('/openapi/v1/apps/:id/files', async (c) => {
    if (state !== undefined) state.uploadCallCount++
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File))
      return errorResponse(ServerErrorCode.ValidationError, 'No file uploaded', 400)
    const ext = file.name.split('.').pop() ?? null
    return Response.json(
      {
        id: 'upload-file-1',
        name: file.name,
        size: file.size,
        extension: ext,
        mime_type: file.type || null,
        created_by: 'acct-1',
      },
      { status: 201 },
    )
  })

  app.post('/openapi/v1/apps/:id/tasks/:taskId:stop', (c) => {
    return c.json({ result: 'success' })
  })

  app.post('/openapi/v1/apps/:id/human-input-forms/:formToken:submit', (c) => {
    return c.json({})
  })

  app.get('/openapi/v1/apps/:id/tasks/:task_id/events', (_c) => sseResponse(hitlResumedResponse()))

  app.post('/openapi/v1/oauth/device/code', (c) => {
    const scenario = getScenario()
    if (scenario === 'no-device-flow')
      return errorResponse(ServerErrorCode.NotFound, 'not found', 404)
    if (scenario === 'bad-verification-uri')
      return c.json({
        device_code: 'devcode-1',
        user_code: 'ABCD-1234',
        verification_uri: BAD_VERIFICATION_URI,
        verification_uri_complete: BAD_VERIFICATION_URI,
        expires_in: 600,
        interval: 1,
      })
    return c.json({
      device_code: 'devcode-1',
      user_code: 'ABCD-1234',
      verification_uri: `${new URL(c.req.url).origin}/device`,
      verification_uri_complete: `${new URL(c.req.url).origin}/device?user_code=ABCD-1234`,
      expires_in: 600,
      interval: 1,
    })
  })

  app.post('/openapi/v1/oauth/device/token', async (c) => {
    const scenario = getScenario()
    if (scenario === 'denied')
      return c.json({ error: 'access_denied', error_description: 'user rejected' }, { status: 400 })
    if (scenario === 'expired')
      return c.json(
        { error: 'expired_token', error_description: 'device_code expired' },
        { status: 400 },
      )
    if (scenario === 'slow-down')
      return c.json({ error: 'slow_down', error_description: 'increase interval' }, { status: 400 })
    if (scenario === 'sso') {
      return c.json({
        token: 'dfoe_test',
        subject_type: 'external_sso',
        subject_email: 'sso@dify.ai',
        subject_issuer: 'https://issuer.example',
        account: null,
        workspaces: [],
        default_workspace_id: null,
        token_id: 'tok-sso-1',
      })
    }
    if (scenario === 'no-email') {
      return c.json({
        token: 'dfoa_test',
        subject_type: 'account',
        account: { id: ACCOUNT.id, email: '', name: '' },
        workspaces: WORKSPACES.map((w) => ({ id: w.id, name: w.name, role: w.role })),
        default_workspace_id: ACCOUNT.current_workspace_id,
        token_id: 'tok-1',
      })
    }
    return c.json({
      token: 'dfoa_test',
      subject_type: 'account',
      account: ACCOUNT,
      workspaces: WORKSPACES.map((w) => ({ id: w.id, name: w.name, role: w.role })),
      default_workspace_id: ACCOUNT.current_workspace_id,
      token_id: 'tok-1',
    })
  })

  return app
}

export function startMock(opts: DifyMockOptions = {}): Promise<DifyMock> {
  let scenario: Scenario = opts.scenario ?? 'happy'
  const state: MockState = {
    lastRunBody: null,
    lastRunParts: null,
    uploadCallCount: 0,
    lastImportBody: null,
    lastRequest: null,
    requestCount: 0,
  }
  const app = buildApp(() => scenario, state)
  return new Promise((resolve, reject) => {
    const server = serve({
      fetch: app.fetch,
      port: opts.port ?? 0,
      hostname: '127.0.0.1',
      overrideGlobalObjects: false,
    })
    server.on('listening', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        scenario,
        setScenario(s) {
          scenario = s
        },
        stop() {
          return new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()))
          })
        },
        get lastRunBody() {
          return state.lastRunBody
        },
        get lastRunParts() {
          return state.lastRunParts
        },
        get uploadCallCount() {
          return state.uploadCallCount
        },
        get lastImportBody() {
          return state.lastImportBody
        },
        get lastRequest() {
          return state.lastRequest
        },
        get requestCount() {
          return state.requestCount
        },
      })
    })
    server.on('error', reject)
  })
}
