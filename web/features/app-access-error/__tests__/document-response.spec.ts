// oxlint-disable-next-line no-restricted-imports -- Exercise the real HTTP request/response boundary used by Proxy, not a mocked status wrapper.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { proxy } from '@/proxy'
import { APP_UNAVAILABLE_IP_HEADER, getWebAppDocumentResponse } from '../document-response'

const configuration = vi.hoisted(() => ({
  WEBAPP_ACCESS_PREFLIGHT_URL: 'http://gateway.internal:8080/api/webapp/access-mode' as
    | string
    | undefined,
  WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET: 'unit-test-ingress-proof' as string | undefined,
}))
vi.mock('@/env', () => ({ env: configuration }))

const fetchMock = vi.fn<typeof fetch>()
function request(path = '/chat/code', headers: Record<string, string> = {}) {
  return new NextRequest(`https://apps.example${path}`, {
    headers: {
      'X-Dify-Webapp-Client-Ip': '203.0.113.42',
      'X-Dify-Webapp-Proxy-Secret': 'unit-test-ingress-proof',
      ...headers,
    },
  })
}
const gate = (incoming: NextRequest) =>
  getWebAppDocumentResponse(incoming, new Headers(incoming.headers))

beforeEach(() => {
  configuration.WEBAPP_ACCESS_PREFLIGHT_URL = 'http://gateway.internal:8080/api/webapp/access-mode'
  configuration.WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET = 'unit-test-ingress-proof'
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(Response.json({ accessMode: 'public' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('WebApp document admission', () => {
  it.each(['chat', 'chatbot', 'workflow', 'completion', 'agent'])(
    'checks %s before rendering with a fresh trusted-hop request',
    async (kind) => {
      expect(
        await gate(
          request(`/${kind}/co%64e?client_ip=198.51.100.1&appCode=other`, {
            'X-Forwarded-For': '198.51.100.1',
            'X-Real-IP': '198.51.100.2',
            Forwarded: 'for=198.51.100.3',
            'CF-Connecting-IP': '198.51.100.4',
            Authorization: 'Bearer untrusted',
            Cookie: 'session=not-forwarded',
          }),
        ),
      ).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        new URL('http://gateway.internal:8080/api/webapp/access-mode?appCode=code'),
        {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          headers: { Accept: 'application/json', 'X-Forwarded-For': '203.0.113.42' },
          signal: expect.any(AbortSignal),
        },
      )
    },
  )

  it.each([
    '/apps',
    '/chatty/code',
    '/chat/code/extra',
    '/environment/chat/code',
    '/environment/workflow/code',
    '/webapp-signin',
    '/form/code',
  ])('does not expand the gate to %s', async (path) => {
    expect(await gate(request(path))).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves the optional gate disabled when its URL is unset', async () => {
    configuration.WEBAPP_ACCESS_PREFLIGHT_URL = undefined
    expect(await gate(request())).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each<Record<string, string>>([
    { 'X-Dify-Webapp-Proxy-Secret': '' },
    { 'X-Dify-Webapp-Proxy-Secret': 'wrong' },
    { 'X-Dify-Webapp-Client-Ip': '' },
    { 'X-Dify-Webapp-Client-Ip': '203.0.113.42, 198.51.100.1' },
    { 'X-Dify-Webapp-Client-Ip': 'unknown' },
  ])('fails closed without trusted ingress proof %j', async (headers) => {
    const result = await gate(request('/chat/code', headers))
    expect(result?.status).toBe(503)
    expect(result?.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects configured preflight without the matching server secret', async () => {
    configuration.WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET = undefined
    expect((await gate(request()))?.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['public', 'private', 'private_all', 'sso_verified'])(
    'retains normal rendering/authentication for access mode %s',
    async (accessMode) => {
      fetchMock.mockResolvedValue(Response.json({ accessMode }))
      expect(await gate(request())).toBeUndefined()
    },
  )

  it('rewrites canonical missing/denied responses to one 404 without exposing application data', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: 'app_not_found', status: 404, message: 'App not found.' },
        { status: 404 },
      ),
    )
    const incoming = request('/workflow/code?client_ip=198.51.100.1', {
      [APP_UNAVAILABLE_IP_HEADER]: '198.51.100.2',
    })
    const forwarded = new Headers(incoming.headers)
    const result = await getWebAppDocumentResponse(incoming, forwarded)
    expect(result?.status).toBe(404)
    expect(result?.headers.get('x-middleware-rewrite')).toBe(
      'https://apps.example/webapp-unavailable',
    )
    expect(result?.headers.get('location')).toBeNull()
    expect(result?.headers.get('cache-control')).toBe('no-store')
    expect(forwarded.get(APP_UNAVAILABLE_IP_HEADER)).toBe('203.0.113.42')
    expect(forwarded.has('x-dify-webapp-proxy-secret')).toBe(false)
    expect(forwarded.has('x-dify-webapp-client-ip')).toBe(false)
  })

  it('clears fabricated internal IP data on a direct error-page visit', async () => {
    const incoming = request('/webapp-unavailable?client_ip=198.51.100.1', {
      [APP_UNAVAILABLE_IP_HEADER]: '198.51.100.2',
    })
    const forwarded = new Headers(incoming.headers)
    const result = await getWebAppDocumentResponse(incoming, forwarded)
    expect(result?.status).toBe(404)
    expect(forwarded.has(APP_UNAVAILABLE_IP_HEADER)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the RSC cache-busting value while removing application query state', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: 'app_not_found', status: 404, message: 'App not found.' },
        { status: 404 },
      ),
    )
    const result = await gate(request('/chat/code?_rsc=transport-value&client_ip=198.51.100.1'))
    expect(result?.status).toBe(404)
    expect(result?.headers.get('x-middleware-rewrite')).toBe(
      'https://apps.example/webapp-unavailable?_rsc=transport-value',
    )
  })

  it('keeps the configured Next basePath on the internal destination', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: 'app_not_found', status: 404, message: 'App not found.' },
        { status: 404 },
      ),
    )
    const incoming = new NextRequest('https://apps.example/dify/chat/code', {
      nextConfig: { basePath: '/dify' },
      headers: request().headers,
    })
    const result = await gate(incoming)
    expect(result?.status).toBe(404)
    expect(result?.headers.get('x-middleware-rewrite')).toBe(
      'https://apps.example/dify/webapp-unavailable',
    )
  })

  it('does not let a browser choose the root error-layout branch for an allowed app', async () => {
    const result = await proxy(
      request('/chat/code', {
        'x-dify-pathname': '/webapp-unavailable',
        [APP_UNAVAILABLE_IP_HEADER]: '198.51.100.1',
      }),
    )
    expect(result.status).toBe(200)
    expect(result.headers.get('x-middleware-rewrite')).toBeNull()
    expect(result.headers.get('x-middleware-request-x-dify-pathname')).toBe('/chat/code')
    expect(result.headers.has(`x-middleware-request-${APP_UNAVAILABLE_IP_HEADER}`)).toBe(false)
  })

  it.each([401, 403, 429, 500, 502, 503])(
    'does not disguise upstream %s as not-found',
    async (status) => {
      fetchMock.mockResolvedValue(Response.json({ code: 'upstream_error' }, { status }))
      expect((await gate(request()))?.status).toBe(503)
    },
  )

  it.each([
    () => new Response('<h1>404</h1>', { status: 404 }),
    () => Response.json({ code: 'other_resource_not_found' }, { status: 404 }),
    () =>
      Response.json(
        { code: 'app_not_found', status: 500, message: 'App not found.' },
        { status: 404 },
      ),
    () =>
      Response.json(
        { code: 'app_not_found', status: 404, message: 'An upstream error' },
        { status: 404 },
      ),
    () => Response.json({ code: 'app_not_found' }, { status: 404 }),
    () => Response.json({ unexpected: true }),
    () => Response.json({ code: 'app_not_found', padding: 'x'.repeat(8192) }, { status: 404 }),
    () => new Response('{', { headers: { 'content-type': 'application/json' }, status: 404 }),
  ])('treats invalid upstream payloads as unavailable, not app-not-found', async (response) => {
    fetchMock.mockResolvedValue(response())
    expect((await gate(request()))?.status).toBe(503)
  })

  it('does not use an allow fallback after a network/timeout failure', async () => {
    fetchMock.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'))
    expect((await gate(request()))?.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
