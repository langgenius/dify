import { ORPCError } from '@orpc/client'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
import {
  isAppDeletionError,
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from './app-deletion'
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

    it('should reject failed responses without notifying the user', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
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
        ),
      )

      await expect(base('/imports')).rejects.toMatchObject({
        code: 'invalid_param',
        message: 'Invalid DSL kind',
        status: 400,
      })
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('App deletion races', () => {
    const notFoundResponse = () =>
      new Response(
        JSON.stringify({
          code: 'not_found',
          message: 'App not found',
          status: 404,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    const rejectionOf = async (request: Promise<unknown>) => {
      try {
        await request
      } catch (error) {
        return error
      }
      throw new Error('Expected the request to reject')
    }

    it('should mark a late workflow 404 for the app being deleted', async () => {
      const appId = 'deleting-app'
      markAppDeletionStarted(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(notFoundResponse())

      try {
        const error = await rejectionOf(base(`/apps/${appId}/workflows/draft/system-variables`))
        expect(isAppDeletionError(error)).toBe(true)
      } finally {
        markAppDeletionFailed(appId)
      }
    })

    it('should mark a workflow 404 that settles after app deletion succeeds', async () => {
      const appId = 'deleted-app'
      markAppDeletionStarted(appId)
      markAppDeletionSucceeded(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(notFoundResponse())

      const error = await rejectionOf(base(`/apps/${appId}/workflows/draft/conversation-variables`))
      expect(isAppDeletionError(error)).toBe(true)
    })

    it('should not mark workflow 404s once app deletion fails', async () => {
      const appId = 'failed-deletion-app'
      markAppDeletionStarted(appId)
      markAppDeletionFailed(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(notFoundResponse())

      const error = await rejectionOf(base(`/apps/${appId}/workflows/draft/variables`))
      expect(isAppDeletionError(error)).toBe(false)
    })

    it.each([
      {
        title: 'another app workflow 404',
        path: '/apps/another-app/workflows/draft/system-variables',
        status: 404,
      },
      {
        title: 'a non-workflow 404',
        path: '/apps/deleting-app',
        status: 404,
      },
      {
        title: 'a workflow 500',
        path: '/apps/deleting-app/workflows/draft/system-variables',
        status: 500,
      },
    ])('should not mark $title while an app is being deleted', async ({ path, status }) => {
      const appId = 'deleting-app'
      markAppDeletionStarted(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ code: 'request_failed', message: 'Visible error', status }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      try {
        const error = await rejectionOf(base(path))
        expect(isAppDeletionError(error)).toBe(false)
      } finally {
        markAppDeletionFailed(appId)
      }
    })
  })
})
