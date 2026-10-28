import { afterEach, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
import { webAppClient } from '@/service/webapp'
import { setWebAppPassport } from '@/service/webapp-auth'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

const originalURL = window.location.href

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  window.history.replaceState({}, '', originalURL)
})

it.each(['default', 'environment'] as const)(
  'keeps %s Preflight JSON buffered for HTTP/1-compatible uploads',
  async (kind) => {
    localStorage.clear()
    window.history.replaceState(
      {},
      '',
      `${kind === 'environment' ? '/environment' : ''}/chat/test-app`,
    )
    setWebAppPassport({ kind, code: 'test-app' }, 'test-passport', 'anonymous')
    const body = {
      connection_revision: '8a7f36f3-7f4d-4d6f-8926-45e1c3ee1598',
      connections: { 'tool-node': null },
    }
    const response = {
      connection_revision: body.connection_revision,
      ready: false,
      connections: [],
    }
    const sent: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      sent.push(new Request(input, init))
      return Response.json(response)
    })

    await expect(webAppClient.connections.preflight.post({ body })).resolves.toEqual(response)

    expect(sent).toHaveLength(1)
    const request = sent[0]!
    const path =
      kind === 'environment'
        ? '/environment/test-app/connections/preflight'
        : '/connections/preflight'
    expect(request.url).toBe(new URL(`${PUBLIC_API_PREFIX}${path}`, window.location.origin).href)
    expect(request.method).toBe('POST')
    expect(request.credentials).toBe('include')
    expect(request.headers.get('X-App-Code')).toBe('test-app')
    expect(request.headers.get('X-App-Passport')).toBe('test-passport')
    expect(request.headers.get('Content-Type')).toContain('application/json')
    // Chromium rejects stream-backed bodies in no-cors mode. Probe a clone without sending it;
    // Happy DOM's body checks cannot detect the stream conversion that breaks HTTP/1 uploads.
    expect(() => new Request(request.clone(), { mode: 'no-cors' })).not.toThrow()
    expect(await request.json()).toEqual(body)
  },
)
