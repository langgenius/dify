import { ORPCError } from '@orpc/client'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- This spec directly tests legacy auth replay.
import { request } from './base'
// oxlint-disable-next-line no-restricted-imports -- This spec directly tests low-level public API routing.
import { base } from './fetch'

const refreshAccessTokenOrReLoginMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/notifications', () => ({
  toast: {
    add: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./refresh-token', () => ({
  refreshAccessTokenOrReLogin: refreshAccessTokenOrReLoginMock,
}))

const { toast } = await import('@/app/notifications')

describe('base', () => {
  const originalUrl = window.location.href
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', originalUrl)
  })

  describe('Public API routing', () => {
    it('should keep ordinary workflow webapps on the Dify public API', async () => {
      window.history.replaceState({}, '', '/workflow/legacy-app')
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

      await base('/site', {}, { isPublicAPI: true })

      const [request] = fetchSpy.mock.calls[0]!
      expect(request).toBeInstanceOf(Request)
      if (!(request instanceof Request)) throw new TypeError('Expected fetch to receive a Request')
      expect(request.url).toBe(`${PUBLIC_API_PREFIX}/site`)
      expect(request.headers.get('X-App-Code')).toBe('legacy-app')
    })

    it('should send sign in to Dify while opening an environment webapp', async () => {
      window.history.replaceState(
        {},
        '',
        '/webapp-signin?redirect_url=%2Fenv%2Fworkflow%2Fworkflow-app',
      )
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

      await base('/login', { method: 'POST' }, { isPublicAPI: true })

      const [request] = fetchSpy.mock.calls[0]!
      if (!(request instanceof Request)) throw new TypeError('Expected fetch to receive a Request')
      expect(request.url).toBe(`${PUBLIC_API_PREFIX}/login`)
    })

    it.each(['/passport', '/webapp/permission', '/workflows/run', 'parameters', 'meta'])(
      'should route %s to the environment webapp API',
      async (path) => {
        window.history.replaceState({}, '', '/environment/workflow/workflow-app')
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

        await base(path, {}, { isPublicAPI: true })

        const [request] = fetchSpy.mock.calls[0]!
        if (!(request instanceof Request))
          throw new TypeError('Expected fetch to receive a Request')
        const expectedPath = path.startsWith('/') ? path : `/${path}`
        expect(request.url).toBe(`${PUBLIC_API_PREFIX}/environment/workflow-app${expectedPath}`)
      },
    )

    it.each([
      '/email-code-login/validity',
      '/forgot-password',
      '/forgot-password/validity',
      '/enterprise/sso/members/oidc/login',
    ])('should keep environment auth path %s on Dify public API', async (path) => {
      window.history.replaceState({}, '', '/environment/workflow/workflow-app')
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

      await base(path, {}, { isPublicAPI: true })

      const [request] = fetchSpy.mock.calls[0]!
      if (!(request instanceof Request)) throw new TypeError('Expected fetch to receive a Request')
      expect(request.url).toBe(`${PUBLIC_API_PREFIX}${path}`)
    })

    it('should route environment login status to the environment API', async () => {
      window.history.replaceState({}, '', '/environment/workflow/workflow-app')
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ logged_in: true, app_logged_in: false })))

      await base('/login/status', {}, { isPublicAPI: true })

      const [request] = fetchSpy.mock.calls[0]!
      if (!(request instanceof Request)) throw new TypeError('Expected fetch to receive a Request')
      expect(request.url).toBe(`${PUBLIC_API_PREFIX}/environment/workflow-app/login/status`)
    })
  })

  it('should replay a caller-owned JSON request after refreshing an expired token', async () => {
    const body = { documentIds: ['document-1'] }
    const callerRequest = new Request(
      'http://localhost/console/api/knowledge-fs/spaces/space-1/documents/reindex',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    const cloneSpy = vi.spyOn(callerRequest, 'clone')
    const sentRequests: Array<{ body: unknown; method: string }> = []
    refreshAccessTokenOrReLoginMock.mockResolvedValue(undefined)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource) => {
      const outgoingRequest =
        resource instanceof Request ? resource : new Request(resource.toString())
      sentRequests.push({
        body: JSON.parse(await outgoingRequest.text()) as unknown,
        method: outgoingRequest.method,
      })
      if (sentRequests.length === 1) {
        return new Response(
          JSON.stringify({
            code: 'unauthorized',
            message: 'Expired access token',
            status: 401,
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }
      return new Response(JSON.stringify({ result: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    // oxlint-disable-next-line typescript/no-deprecated -- This spec directly tests legacy auth replay.
    const response = await request<Response>(
      callerRequest.url,
      {},
      {
        fetchCompat: true,
        request: callerRequest,
      },
    )

    await expect(response.json()).resolves.toEqual({ result: 'queued' })
    expect(refreshAccessTokenOrReLoginMock).toHaveBeenCalledOnce()
    // happy-dom permits reconstructing an already-used Request, unlike browsers.
    // Verify the transport preserves its caller-owned input before ky consumes each attempt.
    expect(cloneSpy).toHaveBeenCalledTimes(2)
    expect(sentRequests).toEqual([
      { body, method: 'POST' },
      { body, method: 'POST' },
    ])
  })

  describe('Error responses', () => {
    it('should preserve structured error details when a 401 response is rejected', async () => {
      // Arrange
      const unauthorizedResponse = new Response(
        JSON.stringify({
          code: 'unauthorized',
          message: 'Unauthorized',
          status: 401,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(unauthorizedResponse)

      // Act
      let caughtError: unknown
      try {
        await base('/login')
      } catch (error) {
        caughtError = error
      }

      // Assert
      expect(caughtError).toBeInstanceOf(ORPCError)
      expect(caughtError).toMatchObject({
        code: 'unauthorized',
        message: 'Unauthorized',
        status: 401,
      })
    })

    it.each([
      { status: 400, body: { error: 'Invalid DSL kind' }, message: 'Invalid DSL kind' },
      {
        status: 403,
        body: { code: 'forbidden', message: 'Permission required' },
        message: 'Permission required',
      },
      { status: 404, body: { message: 'Not found' }, message: 'Not found' },
      { status: 500, body: { message: 'Server unavailable' }, message: 'Server unavailable' },
    ])(
      'propagates HTTP $status and its reason without notifying',
      async ({ status, body, message }) => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, { status }))

        await expect(base('/imports')).rejects.toMatchObject({ status, message, data: body })
        expect(toast.error).not.toHaveBeenCalled()
      },
    )

    it('propagates a proxy HTML failure without notifying', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<h1>Bad gateway</h1>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        }),
      )

      await expect(base('/imports')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
      expect(toast.error).not.toHaveBeenCalled()
    })

    it.each([
      new TypeError('Failed to fetch'),
      new DOMException('The operation timed out.', 'TimeoutError'),
      new DOMException('The operation was aborted.', 'AbortError'),
    ])('preserves transport failure identity without notifying: %s', async (error) => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(error)

      await expect(base('/imports')).rejects.toSatisfy(
        (failure: unknown) =>
          failure === error || (failure instanceof Error && failure.cause === error),
      )
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
