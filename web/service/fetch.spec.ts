import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APPDEPLOY_WEB_API_PREFIX, PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports
import { base } from './fetch'

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    add: vi.fn(),
    error: vi.fn(),
  },
}))

const { toast } = await import('@langgenius/dify-ui/toast')

describe('base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
  })

  describe('Public API routing', () => {
    it.each([
      {
        shareCode: 'env-appdeploy',
        expectedPrefix: APPDEPLOY_WEB_API_PREFIX,
      },
      {
        shareCode: 'legacy-app',
        expectedPrefix: PUBLIC_API_PREFIX,
      },
    ])(
      'should route $shareCode through the expected public API prefix',
      async ({ shareCode, expectedPrefix }) => {
        window.history.replaceState({}, '', `/workflow/${shareCode}`)
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

        await base('/site', {}, { isPublicAPI: true })

        const [request] = fetchSpy.mock.calls[0]!
        expect(request).toBeInstanceOf(Request)
        if (!(request instanceof Request))
          throw new TypeError('Expected fetch to receive a Request')
        expect(request.url).toBe(`${expectedPrefix}/site`)
        expect(request.headers.get('X-App-Code')).toBe(shareCode)
      },
    )

    it('should send signing in to Dify even while an app-deploy app is being opened', async () => {
      // The signin page carries the share code in redirect_url, so routing on
      // the code alone sent /login to the app-deploy gateway, which does not
      // serve it. Authentication belongs to Dify: it issues the token the
      // environment later exchanges for a passport.
      window.history.replaceState(
        {},
        '',
        '/webapp-signin?redirect_url=%2Fworkflow%2Fenv-appdeploy',
      )
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

      await base('/login', { method: 'POST' }, { isPublicAPI: true })

      const [request] = fetchSpy.mock.calls[0]!
      if (!(request instanceof Request))
        throw new TypeError('Expected fetch to receive a Request')
      expect(request.url).toBe(`${PUBLIC_API_PREFIX}/login`)
    })

    it.each([
      '/passport',
      '/login/status',
      '/webapp/permission',
      '/workflows/run',
      // Callers pass some paths bare; matching only the slashed form sent
      // these to Dify's public API, where the env- code does not exist.
      'parameters',
      'meta',
    ])(
      'should keep %s on the app-deploy gateway',
      async (path) => {
        // /login/status is ours even though /login is not, so the split cannot
        // be expressed by excluding an auth prefix.
        window.history.replaceState({}, '', '/workflow/env-appdeploy')
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

        await base(path, {}, { isPublicAPI: true })

        const [request] = fetchSpy.mock.calls[0]!
        if (!(request instanceof Request))
          throw new TypeError('Expected fetch to receive a Request')
        const expectedPath = path.startsWith('/') ? path : `/${path}`
        expect(request.url).toBe(`${APPDEPLOY_WEB_API_PREFIX}${expectedPath}`)
      },
    )
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
      expect(caughtError).toBeInstanceOf(Response)
      await expect((caughtError as Response).json()).resolves.toEqual({
        code: 'unauthorized',
        message: 'Unauthorized',
        status: 401,
      })
    })

    it('should display the response error field when message is absent', async () => {
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

      await expect(base('/imports')).rejects.toBeInstanceOf(Response)

      expect(toast.error).toHaveBeenCalledWith('Invalid DSL kind')
    })

    it('should not display an empty error toast when message and error are absent', async () => {
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

      await expect(base('/imports')).rejects.toBeInstanceOf(Response)

      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
