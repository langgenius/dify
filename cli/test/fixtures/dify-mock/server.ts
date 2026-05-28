import type { AddressInfo } from 'node:net'
import type { Scenario } from './scenarios.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { ACCOUNT, APPS, SESSIONS, WORKSPACES } from './scenarios.js'

export type DifyMockOptions = {
  scenario?: Scenario
  port?: number
}

export type DifyMock = {
  url: string
  port: number
  scenario: Scenario
  setScenario: (s: Scenario) => void
  stop: () => Promise<void>
  /** Body of the most recent POST to /apps/:id/run */
  lastRunBody: Record<string, unknown> | null
  /** Number of times POST /apps/:id/files/upload was called */
  uploadCallCount: number
}

const TOKEN_RE = /^Bearer\s+dfo[ae]_[\w-]+$/

function unauthorized() {
  return Response.json(
    { error: { code: 'auth_expired', message: 'invalid or expired token' } },
    { status: 401 },
  )
}

function sseChunks(events: { event: string, data: Record<string, unknown> }[]): string {
  return events.map(e => `data: ${JSON.stringify({ ...e.data, event: e.event })}\n\n`).join('')
}

function streamingRunResponse(mode: string, query: string, isAgent: boolean): string {
  if (mode === 'workflow') {
    return sseChunks([
      { event: 'workflow_started', data: { id: 'wf-run-1', workflow_id: 'wf-1' } },
      { event: 'node_started', data: { id: 'n1', title: 'first' } },
      { event: 'node_finished', data: { id: 'n1', status: 'succeeded' } },
      { event: 'workflow_finished', data: { id: 'wf-run-1', workflow_id: 'wf-1', data: { id: 'wf-run-1', status: 'succeeded', outputs: { result: `echo: ${query}` } } } },
    ])
  }
  if (mode === 'completion') {
    return sseChunks([
      { event: 'message', data: { message_id: 'msg-1', mode, answer: 'echo: ' } },
      { event: 'message', data: { answer: query } },
      { event: 'message_end', data: { message_id: 'msg-1', task_id: 'task-1', metadata: {} } },
    ])
  }
  const evt = isAgent ? 'agent_message' : 'message'
  const events: { event: string, data: Record<string, unknown> }[] = [
    { event: evt, data: { message_id: 'msg-1', conversation_id: 'conv-1', mode, answer: 'echo: ' } },
    { event: evt, data: { answer: query } },
  ]
  if (isAgent)
    events.push({ event: 'agent_thought', data: { thought: 'thinking…' } })
  events.push({ event: 'message_end', data: { message_id: 'msg-1', conversation_id: 'conv-1', metadata: {} } })
  return sseChunks(events)
}

function hitlPauseResponse(): string {
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
  uploadCallCount: number
}

export function buildApp(getScenario: () => Scenario, state?: MockState): Hono {
  const app = new Hono()

  app.get('/healthz', c => c.json({ ok: true }))

  app.use('*', async (c, next) => {
    if (c.req.path === '/healthz') {
      await next()
      return
    }
    if (c.req.path.startsWith('/openapi/v1/oauth/')) {
      await next()
      return
    }
    if (c.req.path === '/openapi/v1/_version') {
      await next()
      return
    }
    const auth = c.req.header('Authorization') ?? ''
    if (!TOKEN_RE.test(auth))
      return unauthorized()
    const scenario = getScenario()
    if (scenario === 'auth-expired')
      return unauthorized()
    await next()
  })

  app.get('/openapi/v1/_version', (c) => {
    const scenario = getScenario()
    if (scenario === 'server-version-empty')
      return c.json({ version: '', edition: 'SELF_HOSTED' })
    if (scenario === 'server-version-unsupported')
      return c.json({ version: '99.0.0', edition: 'SELF_HOSTED' })
    return c.json({ version: '1.6.4', edition: 'CLOUD' })
  })

  app.use('*', async (c, next) => {
    const scenario = getScenario()
    if (scenario === 'rate-limited') {
      return c.json(
        { error: { code: 'rate_limited', message: 'too many requests' } },
        { status: 429, headers: { 'retry-after': '1' } },
      )
    }
    if (scenario === 'server-5xx') {
      return c.json(
        { error: { code: 'server_5xx', message: 'upstream broken' } },
        { status: 503 },
      )
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
      workspaces: WORKSPACES.map(w => ({ id: w.id, name: w.name, role: w.role })),
      default_workspace_id: 'ws-1',
    })
  })

  app.get('/openapi/v1/account/sessions', (c) => {
    const page = Number(c.req.query('page') ?? '1')
    const limit = Number(c.req.query('limit') ?? '100')
    const total = SESSIONS.length
    const start = (page - 1) * limit
    const slice = SESSIONS.slice(start, start + limit)
    return c.json({
      page,
      limit,
      total,
      has_more: page * limit < total,
      data: slice,
    })
  })

  app.delete('/openapi/v1/account/sessions/self', () =>
    Response.json({ status: 'revoked' }, { status: 200 }))

  app.delete('/openapi/v1/account/sessions/:id', (c) => {
    const id = c.req.param('id')
    if (!SESSIONS.some(s => s.id === id))
      return c.json({ error: { code: 'not_found', message: 'session not found' } }, { status: 404 })
    return Response.json({ status: 'revoked' }, { status: 200 })
  })

  app.get('/openapi/v1/workspaces', (c) => {
    if (getScenario() === 'sso')
      return c.json({ workspaces: [] })
    return c.json({
      workspaces: WORKSPACES.map(w => ({
        id: w.id,
        name: w.name,
        role: w.role,
        status: w.status,
        current: w.is_current,
      })),
    })
  })

  app.get('/openapi/v1/apps', (c) => {
    const page = Number(c.req.query('page') ?? '1')
    const limit = Number(c.req.query('limit') ?? '20')
    const mode = c.req.query('mode')
    const tag = c.req.query('tag')
    const name = c.req.query('name')
    const workspaceId = c.req.query('workspace_id') ?? 'ws-1'
    let filtered = APPS.filter(a => a.workspace_id === workspaceId)
    if (mode !== undefined && mode !== '')
      filtered = filtered.filter(a => a.mode === mode)
    if (tag !== undefined && tag !== '')
      filtered = filtered.filter(a => a.tags.some(t => t.name === tag))
    if (name !== undefined && name !== '')
      filtered = filtered.filter(a => a.name.includes(name))
    const total = filtered.length
    const start = (page - 1) * limit
    const slice = filtered.slice(start, start + limit)
    return c.json({
      page,
      limit,
      total,
      has_more: page * limit < total,
      data: slice,
    })
  })

  app.get('/openapi/v1/apps/:id/describe', (c) => {
    const id = c.req.param('id')
    const wsId = c.req.query('workspace_id')
    const fieldsRaw = c.req.query('fields') ?? ''
    const fields = fieldsRaw === '' ? [] : fieldsRaw.split(',').map(s => s.trim()).filter(s => s !== '')
    const app = APPS.find(a => a.id === id && (wsId === undefined || wsId === '' || a.workspace_id === wsId))
    if (app === undefined)
      return c.json({ error: { code: 'not_found', message: 'app not found' } }, { status: 404 })
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
            author: app.author ?? '',
            tags: app.tags,
            updated_at: app.updated_at,
            service_api_enabled: app.service_api_enabled ?? false,
            is_agent: app.is_agent ?? false,
          }
        : null,
      parameters: wantParams ? (app.parameters ?? null) : null,
      input_schema: wantInputSchema ? (app.input_schema ?? null) : null,
    })
  })

  app.post('/openapi/v1/apps/:id/run', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json() as { query?: string, inputs?: unknown }
    if (state !== undefined)
      state.lastRunBody = body as Record<string, unknown>
    const app = APPS.find(a => a.id === id)
    if (app === undefined)
      return c.json({ error: { code: 'not_found', message: 'app not found' } }, { status: 404 })
    const isAgent = app.is_agent === true || app.mode === 'agent-chat'
    const query = body.query ?? ''
    const scenario = getScenario()
    if (scenario === 'stream-error') {
      const errSse = sseChunks([{ event: 'error', data: { message: 'boom', status: 503 } }])
      return new Response(errSse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (scenario === 'hitl-pause') {
      return new Response(hitlPauseResponse(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const sse = streamingRunResponse(app.mode, query, isAgent)
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })

  app.post('/openapi/v1/apps/:id/files/upload', async (c) => {
    if (state !== undefined)
      state.uploadCallCount++
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File))
      return Response.json({ message: 'No file uploaded' }, { status: 400 })
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

  app.post('/openapi/v1/apps/:id/tasks/:taskId/stop', (c) => {
    return c.json({ result: 'success' })
  })

  app.post('/openapi/v1/apps/:id/form/human_input/:formToken', (c) => {
    return c.json({})
  })

  app.get('/openapi/v1/apps/:id/tasks/:task_id/events', (_c) => {
    return new Response(hitlResumedResponse(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })

  app.post('/openapi/v1/oauth/device/code', c =>
    c.json({
      device_code: 'devcode-1',
      user_code: 'ABCD-1234',
      verification_uri: `${new URL(c.req.url).origin}/device`,
      verification_uri_complete: `${new URL(c.req.url).origin}/device?user_code=ABCD-1234`,
      expires_in: 600,
      interval: 1,
    }))

  app.post('/openapi/v1/oauth/device/token', async (c) => {
    const scenario = getScenario()
    if (scenario === 'denied')
      return c.json({ error: 'access_denied', error_description: 'user rejected' }, { status: 400 })
    if (scenario === 'expired')
      return c.json({ error: 'expired_token', error_description: 'device_code expired' }, { status: 400 })
    if (scenario === 'slow-down')
      return c.json({ error: 'slow_down', error_description: 'increase interval' }, { status: 400 })
    if (scenario === 'sso') {
      return c.json({
        token: 'dfoe_test',
        subject_type: 'external_sso',
        subject_email: 'sso@dify.ai',
        subject_issuer: 'https://issuer.example',
        token_id: 'tok-sso-1',
      })
    }
    return c.json({
      token: 'dfoa_test',
      subject_type: 'account',
      account: ACCOUNT,
      workspaces: WORKSPACES.map(w => ({ id: w.id, name: w.name, role: w.role })),
      default_workspace_id: 'ws-1',
      token_id: 'tok-1',
    })
  })

  return app
}

export function startMock(opts: DifyMockOptions = {}): Promise<DifyMock> {
  let scenario: Scenario = opts.scenario ?? 'happy'
  const state: MockState = { lastRunBody: null, uploadCallCount: 0 }
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
        setScenario(s) { scenario = s },
        stop() {
          return new Promise<void>((res, rej) => {
            server.close(err => err ? rej(err) : res())
          })
        },
        get lastRunBody() { return state.lastRunBody },
        get uploadCallCount() { return state.uploadCallCount },
      })
    })
    server.on('error', reject)
  })
}
