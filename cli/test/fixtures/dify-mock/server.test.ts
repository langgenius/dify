import type { DifyMock } from './server.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMock } from './server.js'

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
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(200)
  })

  it('accepts dfoe_ tokens (enterprise/external-subject)', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer dfoe_test' },
    })
    expect(r.status).toBe(200)
  })

  it('GET /openapi/v1/workspaces returns the seeded list with status + current', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(200)
    const body = await r.json() as {
      workspaces: Array<{ id: string, name: string, role: string, status: string, current: boolean }>
    }
    expect(body.workspaces).toHaveLength(2)
    expect(body.workspaces[0]?.id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(body.workspaces[0]?.status).toBe('normal')
    expect(body.workspaces[0]?.current).toBe(true)
    expect(body.workspaces[1]?.current).toBe(false)
  })

  it('GET /openapi/v1/workspaces returns empty list under sso scenario', async () => {
    mock.setScenario('sso')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(200)
    const body = await r.json() as { workspaces: unknown[] }
    expect(body.workspaces).toHaveLength(0)
  })

  it('GET /openapi/v1/account returns the seeded account envelope', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/account`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(200)
    const body = await r.json() as {
      subject_type: string
      account: { email: string } | null
      workspaces: Array<{ id: string }>
      default_workspace_id: string
    }
    expect(body.subject_type).toBe('account')
    expect(body.account?.email).toBe('tester@dify.ai')
    expect(body.workspaces).toHaveLength(2)
    expect(body.default_workspace_id).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('GET /openapi/v1/apps respects ?mode filter', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps?workspace_id=550e8400-e29b-41d4-a716-446655440000&mode=workflow`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    const body = await r.json() as { data: Array<{ mode: string }>, total: number }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.mode).toBe('workflow')
    expect(body.total).toBe(1)
  })

  it('GET /openapi/v1/apps scopes by workspace_id', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps?workspace_id=550e8400-e29b-41d4-a716-446655440001`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    const body = await r.json() as { data: Array<{ id: string }> }
    expect(body.data).toHaveLength(2)
    expect(body.data.map(r => r.id).sort()).toEqual(['app-3', 'app-4'])
  })

  it('GET /openapi/v1/apps/:id/describe returns 404 for unknown id', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/nope/describe?workspace_id=550e8400-e29b-41d4-a716-446655440000`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(404)
  })

  it('GET /openapi/v1/apps/:id/describe returns the app for known id', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1/describe?workspace_id=550e8400-e29b-41d4-a716-446655440000`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(200)
    const body = await r.json() as { info: { id: string } }
    expect(body.info.id).toBe('app-1')
  })

  it('POST /openapi/v1/apps/:id/run returns SSE stream for chat app', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1/run`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer dfoa_test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'hi', inputs: {} }),
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    const text = await r.text()
    expect(text).toContain('"answer":"echo: "')
  })

  it('POST /openapi/v1/apps/:id/run returns SSE stream for workflow app', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-2/run`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer dfoa_test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: { x: 1 } }),
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    const text = await r.text()
    expect(text).toContain('"workflow_finished"')
  })

  it('GET /openapi/v1/apps/:id/describe?fields=info returns slim payload', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1/describe?workspace_id=550e8400-e29b-41d4-a716-446655440000&fields=info`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(200)
    const body = await r.json() as { info: { id: string }, parameters: unknown, input_schema: unknown }
    expect(body.info.id).toBe('app-1')
    expect(body.parameters).toBeNull()
    expect(body.input_schema).toBeNull()
  })

  it('GET /openapi/v1/apps/:id/describe full returns parameters when present', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/apps/app-1/describe?workspace_id=550e8400-e29b-41d4-a716-446655440000`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(200)
    const body = await r.json() as { parameters: { opening_statement: string } | null }
    expect(body.parameters?.opening_statement).toBe('Hi, I am Greeter.')
  })

  it('POST /openapi/v1/oauth/device/code returns RFC 8628 fields', async () => {
    const r = await fetch(`${mock.url}/openapi/v1/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'difyctl', device_label: 'difyctl on host' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json() as Record<string, unknown>
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
    const body = await r.json() as { token: string, subject_type: string, account?: { email: string } }
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
    const body = await r.json() as { token: string, subject_type: string, subject_email: string }
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
    const body = await r.json() as { error: string }
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
    const body = await r.json() as { error: string }
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
    const body = await r.json() as { error: string }
    expect(body.error).toBe('slow_down')
  })

  it('scenario:auth-expired returns 401 on bearer-protected endpoint', async () => {
    mock.setScenario('auth-expired')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(401)
  })

  it('scenario:rate-limited returns 429 with retry-after', async () => {
    mock.setScenario('rate-limited')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('1')
  })

  it('scenario:server-5xx returns 503', async () => {
    mock.setScenario('server-5xx')
    const r = await fetch(`${mock.url}/openapi/v1/workspaces`, {
      headers: { Authorization: 'Bearer dfoa_test' },
    })
    expect(r.status).toBe(503)
  })
})
