import type { DifyMock } from './server.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { CATALOG_HEADER, CATALOG_PATH } from '@/plugins/catalog'
import { startMock } from './server.js'

const CATALOG_FIXTURE = readFileSync(join(__dirname, '../catalog.json'))
const CATALOG_V2_FIXTURE = readFileSync(join(__dirname, '../catalog-v2.json'))
const CATALOG_FINGERPRINT = createHash('sha256').update(CATALOG_FIXTURE).digest('hex')
const CATALOG_V2_FINGERPRINT = createHash('sha256').update(CATALOG_V2_FIXTURE).digest('hex')

const AUTH_HEADERS = { Authorization: 'Bearer dfoa_test', [CATALOG_HEADER]: CATALOG_FINGERPRINT }

describe('dify-mock fixture server', () => {
  let mock: DifyMock

  beforeEach(async () => {
    mock = await startMock()
  })

  afterEach(async () => {
    await mock.stop()
  })

  it('listens on an ephemeral port', () => {
    expect(mock.port).toBeGreaterThan(0)
    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('GET /healthz returns 200 without auth', async () => {
    const r = await fetch(`${mock.url}/healthz`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('rejects /openapi/v1/* without Authorization header', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`)
    expect(r.status).toBe(401)
  })

  it('rejects malformed Bearer tokens', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer wrongprefix_abc' },
    })
    expect(r.status).toBe(401)
  })

  it('accepts dfoa_ tokens (community/account)', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(200)
  })

  it('accepts dfoe_ tokens (enterprise/external-subject)', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { ...AUTH_HEADERS, Authorization: 'Bearer dfoe_test' },
    })
    expect(r.status).toBe(200)
  })

  it('GET /openapi/v1/workspaces returns the seeded list with status + current', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      data: Array<{
        id: string
        name: string
        role: string
        status: string
        current: boolean
      }>
      hints: unknown[]
    }
    expect(body.data).toHaveLength(2)
    expect(body.data[0]?.id).toBe('ws-1')
    expect(body.data[0]?.status).toBe('normal')
    expect(body.data[0]?.current).toBe(true)
    expect(body.data[1]?.current).toBe(false)
    expect(body.hints).toEqual([])
  })

  it('GET /openapi/v1/workspaces returns empty list under sso scenario', async () => {
    mock.setScenario('sso')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('GET /openapi/v1/account returns the seeded account envelope', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/account`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      subject_type: string
      account: { email: string } | null
      workspaces: Array<{ id: string }>
      default_workspace_id: string
    }
    expect(body.subject_type).toBe('account')
    expect(body.account?.email).toBe('tester@dify.ai')
    expect(body.workspaces).toHaveLength(2)
    expect(body.default_workspace_id).toBe('ws-1')
  })

  it('GET /openapi/v1/apps respects ?mode filter', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps?workspace_id=ws-1&mode=workflow`, {
      headers: AUTH_HEADERS,
    })
    const body = (await r.json()) as { data: Array<{ mode: string }>; total: number }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.mode).toBe('workflow')
    expect(body.total).toBe(1)
  })

  it('GET /openapi/v1/apps scopes by workspace_id', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps?workspace_id=ws-2`, {
      headers: AUTH_HEADERS,
    })
    const body = (await r.json()) as { data: Array<{ id: string }> }
    expect(body.data).toHaveLength(2)
    expect(body.data.map((r) => r.id).sort()).toEqual(['app-3', 'app-4'])
  })

  it('GET /openapi/v1/apps paginates with a "Next page" hint when has_more', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps?workspace_id=ws-1&limit=1`, {
      headers: AUTH_HEADERS,
    })
    const body = (await r.json()) as { has_more: boolean; hints: Array<Record<string, unknown>> }
    expect(body.has_more).toBe(true)
    expect(body.hints).toEqual([
      {
        summary: 'Next page',
        op: 'console_app.list',
        input: { workspace_id: 'ws-1', page: 2, limit: 1 },
      },
    ])
  })

  it('GET /openapi/v1/apps/:id returns 404 for unknown id', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/nope?workspace_id=ws-1`, {
      headers: AUTH_HEADERS,
    })
    expect(r.status).toBe(404)
    const body = (await r.json()) as { code: string; message: string; status: number }
    expect(body).toEqual({ code: 'not_found', message: 'app not found', status: 404 })
  })

  it('GET /openapi/v1/apps/:id returns the app for known id', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1?workspace_id=ws-1`, {
      headers: AUTH_HEADERS,
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { info: { id: string } }
    expect(body.info.id).toBe('app-1')
  })

  it('POST /openapi/v1/apps/:id:run returns SSE stream for chat app', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1:run`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hi', inputs: {} }),
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    const text = await r.text()
    expect(text).toContain('"answer":"echo: "')
    expect(text).toContain('"op":"console_app.chat.run"')
  })

  it('POST /openapi/v1/apps/:id:run returns SSE stream for workflow app', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-2:run`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { x: 1 } }),
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    const text = await r.text()
    expect(text).toContain('"workflow_finished"')
  })

  it('POST /openapi/v1/apps/:id/workflow:run runs the workflow app by mode-specific route', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-2/workflow:run`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { x: 1 } }),
    })
    expect(r.status).toBe(200)
    const text = await r.text()
    expect(text).toContain('"workflow_finished"')
    expect(mock.lastRunBody).toEqual({ inputs: { x: 1 } })
  })

  it('POST /openapi/v1/apps/:id/chat:run runs the chat app by mode-specific route', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1/chat:run`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hi', inputs: {} }),
    })
    expect(r.status).toBe(200)
    const text = await r.text()
    expect(text).toContain('"answer":"echo: "')
  })

  it('POST /openapi/v1/apps/:id/chat:run accepts multipart bodies and records the parts', async () => {
    const form = new FormData()
    form.set('query', JSON.stringify('hi'))
    form.set('inputs', JSON.stringify({}))
    form.set('files[avatar]', new File(['x'], 'avatar.png', { type: 'image/png' }))
    form.append('attachments[]', new File(['a'], 'a.txt'))
    form.append('attachments[]', new File(['b'], 'b.txt'))
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1/chat:run`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: form,
    })
    expect(r.status).toBe(200)
    expect(mock.lastRunBody).toEqual({ query: 'hi', inputs: {} })
    const parts = mock.lastRunParts
    expect(parts?.query).toBe('"hi"')
    const avatar = parts?.['files[avatar]']
    expect(Array.isArray(avatar) && avatar[0]?.name).toBe('avatar.png')
    const attachments = parts?.['attachments[]']
    expect(Array.isArray(attachments) && attachments.length).toBe(2)
  })

  it('GET /openapi/v1/apps/:id?fields=info returns slim payload', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1?workspace_id=ws-1&fields=info`, {
      headers: AUTH_HEADERS,
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      info: { id: string }
      parameters: unknown
      input_schema: unknown
    }
    expect(body.info.id).toBe('app-1')
    expect(body.parameters).toBeNull()
    expect(body.input_schema).toBeNull()
  })

  it('GET /openapi/v1/apps/:id full returns parameters when present', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1?workspace_id=ws-1`, {
      headers: AUTH_HEADERS,
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { parameters: { opening_statement: string } | null }
    expect(body.parameters?.opening_statement).toBe('Hi, I am Greeter.')
  })

  it('POST /openapi/v1/oauth/device/code returns RFC 8628 fields', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'difyctl', device_label: 'difyctl on host' }),
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as Record<string, unknown>
    expect(body.device_code).toBeDefined()
    expect(body.user_code).toBeDefined()
    expect(body.interval).toBeDefined()
  })

  it('POST /openapi/v1/oauth/device/token returns Dify token envelope', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'difyctl', device_code: 'devcode-1' }),
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      token: string
      subject_type: string
      account?: { email: string }
    }
    expect(body.token).toMatch(/^dfoa_/)
    expect(body.subject_type).toBe('account')
    expect(body.account?.email).toBe('tester@dify.ai')
  })

  it('scenario:sso returns external_sso envelope with dfoe_ token', async () => {
    mock.setScenario('sso')
    const r = await fetch(`${mock.url}/openapi/v1/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'devcode-1' }),
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { token: string; subject_type: string; subject_email: string }
    expect(body.token).toMatch(/^dfoe_/)
    expect(body.subject_type).toBe('external_sso')
    expect(body.subject_email).toBe('sso@dify.ai')
  })

  it('scenario:denied returns access_denied on token poll', async () => {
    mock.setScenario('denied')
    const r = await fetch(`${mock.url}/openapi/v1/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'devcode-1' }),
    })
    expect(r.status).toBe(400)
    const body = (await r.json()) as { error: string }
    expect(body.error).toBe('access_denied')
  })

  it('scenario:expired returns expired_token on token poll', async () => {
    mock.setScenario('expired')
    const r = await fetch(`${mock.url}/openapi/v1/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'devcode-1' }),
    })
    expect(r.status).toBe(400)
    const body = (await r.json()) as { error: string }
    expect(body.error).toBe('expired_token')
  })

  it('scenario:slow-down returns slow_down on token poll', async () => {
    mock.setScenario('slow-down')
    const r = await fetch(`${mock.url}/openapi/v1/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'devcode-1' }),
    })
    expect(r.status).toBe(400)
    const body = (await r.json()) as { error: string }
    expect(body.error).toBe('slow_down')
  })

  it('scenario:auth-expired returns 401 on bearer-protected endpoint', async () => {
    mock.setScenario('auth-expired')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(401)
    const body = (await r.json()) as { code: string }
    expect(body.code).toBe('unauthorized')
  })

  it('scenario:rate-limited returns 429 with retry-after', async () => {
    mock.setScenario('rate-limited')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('1')
    const body = (await r.json()) as { code: string; status: number }
    expect(body).toMatchObject({ code: 'rate_limited', status: 429 })
  })

  it('scenario:server-5xx returns 503', async () => {
    mock.setScenario('server-5xx')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(503)
    const body = (await r.json()) as { code: string; status: number }
    expect(body).toMatchObject({ code: 'server_5xx', status: 503 })
  })

  it('GET _catalog serves the catalog bytes and its own fingerprint header, no auth required', async () => {
    const r = await fetch(`${mock.url}${CATALOG_PATH}`)
    expect(r.status).toBe(200)
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array(CATALOG_FIXTURE))
    expect(r.headers.get(CATALOG_HEADER.toLowerCase())).toBe(CATALOG_FINGERPRINT)
  })

  it('scenario:catalog-changed serves catalog-v2 bytes and fingerprint', async () => {
    mock.setScenario('catalog-changed')
    const r = await fetch(`${mock.url}${CATALOG_PATH}`)
    expect(r.status).toBe(200)
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array(CATALOG_V2_FIXTURE))
    expect(r.headers.get(CATALOG_HEADER.toLowerCase())).toBe(CATALOG_V2_FINGERPRINT)
  })

  it('scenario:no-catalog returns 404 for _catalog', async () => {
    mock.setScenario('no-catalog')
    const r = await fetch(`${mock.url}${CATALOG_PATH}`)
    expect(r.status).toBe(404)
  })

  it('every response carries the current catalog fingerprint header', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/account`, { headers: AUTH_HEADERS })
    expect(r.headers.get(CATALOG_HEADER.toLowerCase())).toBe(CATALOG_FINGERPRINT)
  })

  it('rejects a stale X-Dify-Catalog header with 412', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/account`, {
      headers: { Authorization: 'Bearer dfoa_test', [CATALOG_HEADER]: 'deadbeef' },
    })
    expect(r.status).toBe(412)
    const body = (await r.json()) as { code: string; message: string; status: number; hint: string }
    expect(body).toEqual({
      code: 'catalog_stale',
      message: "The request was built from a catalog that is not this server's current catalog.",
      status: 412,
      hint: 'GET /openapi/v1/_catalog, rebuild the request from it, and send its sha256 in X-Dify-Catalog.',
    })
  })

  it('scenario:always-stale rejects even a fresh header', async () => {
    mock.setScenario('always-stale')
    const r = await fetch(`${mock.url}/openapi/v1/account`, { headers: AUTH_HEADERS })
    expect(r.status).toBe(412)
  })

  it('_version and oauth/* are exempt from the catalog gate', async () => {
    const version = await fetch(`${mock.url}/openapi/v1/_version`)
    expect(version.status).toBe(200)
    const device = await fetch(`${mock.url}/openapi/v1/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(device.status).toBe(200)
  })

  it('tracks lastRequest (with query string) and requestCount across requests', async () => {
    expect(mock.requestCount).toBe(0)
    await fetch(`${mock.url}${CATALOG_PATH}`)
    await fetch(`${mock.url}/openapi/v1/apps?limit=1&workspace_id=ws-1`, { headers: AUTH_HEADERS })
    expect(mock.requestCount).toBe(2)
    expect(mock.lastRequest).toMatchObject({
      method: 'GET',
      path: '/openapi/v1/apps?limit=1&workspace_id=ws-1',
    })
    expect(mock.lastRequest?.headers.authorization).toBe('Bearer dfoa_test')
  })
})
