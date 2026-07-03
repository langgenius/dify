import type { AddressInfo } from 'node:net'
import type { Scenario } from './scenarios.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { ACCOUNT, APPS, DSL_YAML, SESSIONS, WORKSPACES } from './scenarios.js'

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
  /** Body of the most recent POST to /apps/:id:run */
  lastRunBody: Record<string, unknown> | null
  /** Number of times POST /apps/:id/files was called */
  uploadCallCount: number
  /** Body of the most recent POST to /workspaces/:id/apps/imports */
  lastImportBody: Record<string, unknown> | null
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
  lastImportBody: Record<string, unknown> | null
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
      // Unified ErrorBody — per-token throttle (retryable); Retry-After advises the wait.
      return c.json(
        { code: 'too_many_requests', message: 'Too many requests for this API token.', status: 429 },
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
      default_workspace_id: ACCOUNT.current_workspace_id,
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
    const workspaceId = c.req.query('workspace_id') ?? ACCOUNT.current_workspace_id
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

  app.get('/openapi/v1/apps/:id', (c) => {
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
    const fields = fieldsRaw === '' ? [] : fieldsRaw.split(',').map(s => s.trim()).filter(s => s !== '')
    // External subjects have no workspace scope; the app is reachable across workspaces.
    const app = APPS.find(a => a.id === id)
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
    const found = APPS.find(a => a.id === id)
    if (found === undefined)
      return c.json({ error: { code: 'not_found', message: 'app not found' } }, { status: 404 })
    return c.json({ data: DSL_YAML })
  })

  app.get('/openapi/v1/apps/:id/dependencies', (c) => {
    const id = c.req.param('id')
    const found = APPS.find(a => a.id === id)
    if (found === undefined)
      return c.json({ error: { code: 'not_found', message: 'app not found' } }, { status: 404 })
    return c.json({ leaked_dependencies: [] })
  })

  app.post('/openapi/v1/workspaces/:wsId/apps/imports', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    if (state !== undefined)
      state.lastImportBody = body
    const scenario = getScenario()
    if (scenario === 'import-failed')
      return c.json({ id: 'imp-1', status: 'failed', error: 'unsupported DSL version' }, { status: 200 })
    if (scenario === 'import-pending')
      return c.json({ id: 'imp-1', status: 'pending', current_dsl_version: '0.1.4', imported_dsl_version: '0.0.9' }, { status: 202 })
    return c.json({ id: 'imp-1', status: 'completed', app_id: 'app-1', app_mode: 'chat' }, { status: 200 })
  })

  app.post('/openapi/v1/workspaces/:wsId/apps/imports/:importId:confirm', (c) => {
    return c.json({ id: 'imp-1', status: 'completed', app_id: 'app-1', app_mode: 'chat' }, { status: 200 })
  })

  app.post('/openapi/v1/apps/:id:run', async (c) => {
    // Hono drops the param adjacent to the `:run` literal; recover the app id from the path.
    const id = c.req.path.replace(/^.*\/apps\//, '').replace(/:run$/, '')
    const body = await c.req.json() as { query?: string, inputs?: unknown }
    if (state !== undefined)
      state.lastRunBody = body as Record<string, unknown>
    const app = APPS.find(a => a.id === id)
    if (app === undefined)
      return c.json({ error: { code: 'not_found', message: 'app not found' } }, { status: 404 })
    const isAgent = app.is_agent === true || app.mode === 'agent-chat'
    const query = body.query ?? ''
    const scenario = getScenario()
    if (scenario === 'run-422-stale') {
      return c.json(
        { error: { code: 'query_not_supported_for_workflow', message: 'query not supported for workflow mode' } },
        { status: 422 },
      )
    }
    if (scenario === 'stream-error') {
      const errSse = sseChunks([{ event: 'error', data: { message: 'boom', status: 503 } }])
      return new Response(errSse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (scenario === 'hitl-pause') {
      return new Response(hitlPauseResponse(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (scenario === 'workflow-think') {
      const thinkSse = sseChunks([
        { event: 'workflow_started', data: { id: 'wf-run-1', workflow_id: 'wf-1' } },
        { event: 'workflow_finished', data: { id: 'wf-run-1', workflow_id: 'wf-1', data: { id: 'wf-run-1', status: 'succeeded', outputs: { result: '<think>secret reasoning</think>\nfinal answer' } } } },
      ])
      return new Response(thinkSse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (scenario === 'chat-reasoning') {
      // Separated mode: reasoning streams out-of-band on `reasoning_chunk` (nested
      // under `data`), the answer stays free of <think>, and the terminal reasoning
      // is persisted into message_end metadata.
      const reasoningSse = sseChunks([
        { event: 'reasoning_chunk', data: { data: { message_id: 'msg-1', reasoning: 'secret reasoning', node_id: 'llm-1', is_final: false } } },
        { event: 'reasoning_chunk', data: { data: { message_id: 'msg-1', reasoning: '', node_id: 'llm-1', is_final: true } } },
        { event: 'message', data: { message_id: 'msg-1', conversation_id: 'conv-1', mode: app.mode, answer: 'final answer' } },
        { event: 'message_end', data: { message_id: 'msg-1', conversation_id: 'conv-1', task_id: 'task-1', metadata: { reasoning: { 'llm-1': 'secret reasoning' } } } },
      ])
      return new Response(reasoningSse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (scenario === 'workflow-reasoning') {
      // Separated mode in a workflow: reasoning streams out-of-band on
      // `reasoning_chunk` (no message_id), outputs stay clean, and there is NO
      // persisted metadata — the live deltas are the only source.
      const wfReasoningSse = sseChunks([
        { event: 'workflow_started', data: { id: 'wf-run-1', workflow_id: 'wf-1' } },
        { event: 'node_started', data: { id: 'llm-1', title: 'LLM' } },
        { event: 'reasoning_chunk', data: { data: { reasoning: 'secret reasoning', node_id: 'llm-1', is_final: false } } },
        { event: 'reasoning_chunk', data: { data: { reasoning: '', node_id: 'llm-1', is_final: true } } },
        { event: 'node_finished', data: { id: 'llm-1', status: 'succeeded' } },
        { event: 'workflow_finished', data: { id: 'wf-run-1', workflow_id: 'wf-1', data: { id: 'wf-run-1', status: 'succeeded', outputs: { result: 'final answer' } } } },
      ])
      return new Response(wfReasoningSse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const sse = streamingRunResponse(app.mode, query, isAgent)
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })

  app.post('/openapi/v1/apps/:id/files', async (c) => {
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

  app.post('/openapi/v1/apps/:id/tasks/:taskId:stop', (c) => {
    return c.json({ result: 'success' })
  })

  app.post('/openapi/v1/apps/:id/human-input-forms/:formToken:submit', (c) => {
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
        workspaces: WORKSPACES.map(w => ({ id: w.id, name: w.name, role: w.role })),
        default_workspace_id: ACCOUNT.current_workspace_id,
        token_id: 'tok-1',
      })
    }
    return c.json({
      token: 'dfoa_test',
      subject_type: 'account',
      account: ACCOUNT,
      workspaces: WORKSPACES.map(w => ({ id: w.id, name: w.name, role: w.role })),
      default_workspace_id: ACCOUNT.current_workspace_id,
      token_id: 'tok-1',
    })
  })

  return app
}

export function startMock(opts: DifyMockOptions = {}): Promise<DifyMock> {
  let scenario: Scenario = opts.scenario ?? 'happy'
  const state: MockState = { lastRunBody: null, uploadCallCount: 0, lastImportBody: null }
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
        get lastImportBody() { return state.lastImportBody },
      })
    })
    server.on('error', reject)
  })
}
