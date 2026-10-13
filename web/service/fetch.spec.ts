import { ORPCError } from '@orpc/client'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports
import { base } from './fetch'

vi.mock('@/app/notifications', () => ({
  toast: {
    add: vi.fn(),
    error: vi.fn(),
  },
}))

const { toast } = await import('@/app/notifications')

describe('base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
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

  describe('Error responses', () => {
    it('should keep the response body readable when a 401 response is rejected', async () => {
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

    it('should expose the response error field when message is absent', async () => {
      const errorResponse = new Response(
        JSON.stringify({
          code: 'invalid_param',
          error: 'Invalid DSL kind',
          status: 400,
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(errorResponse)

      await expect(base('/imports')).rejects.toMatchObject({
        message: 'Invalid DSL kind',
        status: 400,
      })
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('should expose the HTTP fallback when message and error are absent', async () => {
      const errorResponse = new Response(
        JSON.stringify({
          code: 'invalid_param',
          status: 400,
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(errorResponse)

      await expect(base('/imports')).rejects.toMatchObject({ message: 'HTTP 400', status: 400 })
      expect(toast.error).not.toHaveBeenCalled()
    })

    it.each([400, 401, 403, 404, 409, 429, 500, 502, 503])(
      'rejects HTTP %s without presenting an error',
      async (status) => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response('<html>Proxy failure</html>', { status }),
        )

        await expect(base('/apps')).rejects.toMatchObject({ status, message: `HTTP ${status}` })
        expect(toast.error).not.toHaveBeenCalled()
      },
    )

    it('propagates network failure without presenting an error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(base('/apps')).rejects.toBeInstanceOf(Error)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('propagates cancellation without presenting an error', async () => {
      const controller = new AbortController()
      controller.abort()
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(controller.signal.reason)

      await expect(base('/apps', { signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('leaves setup navigation to the authentication owner', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ code: 'already_setup', message: 'Already set up' }, { status: 403 }),
      )

      await expect(base('/setup')).rejects.toMatchObject({ code: 'already_setup', status: 403 })
      expect(window.location.pathname).toBe('/')
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
