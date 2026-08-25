import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
import {
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from './app-deletion'
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
        window.history.replaceState({}, '', '/env/workflow/workflow-app')
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

        await base(path, {}, { isPublicAPI: true })

        const [request] = fetchSpy.mock.calls[0]!
        if (!(request instanceof Request))
          throw new TypeError('Expected fetch to receive a Request')
        const expectedPath = path.startsWith('/') ? path : `/${path}`
        expect(request.url).toBe(`${PUBLIC_API_PREFIX}/env/workflow-app${expectedPath}`)
      },
    )

    it.each([
      '/login/status',
      '/email-code-login/validity',
      '/forgot-password',
      '/forgot-password/validity',
      '/enterprise/sso/members/oidc/login',
    ])('should keep environment auth path %s on Dify public API', async (path) => {
      window.history.replaceState({}, '', '/env/workflow/workflow-app')
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ result: 'ok' })))

      await base(path, {}, { isPublicAPI: true })

      const [request] = fetchSpy.mock.calls[0]!
      if (!(request instanceof Request)) throw new TypeError('Expected fetch to receive a Request')
      expect(request.url).toBe(`${PUBLIC_API_PREFIX}${path}`)
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

    it('should suppress a late workflow 404 for the app being deleted', async () => {
      const appId = 'deleting-app'
      markAppDeletionStarted(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
        ),
      )

      try {
        await expect(
          base(`/apps/${appId}/workflows/draft/system-variables`),
        ).rejects.toBeInstanceOf(Response)
        expect(toast.error).not.toHaveBeenCalled()
      } finally {
        markAppDeletionFailed(appId)
      }
    })

    it('should suppress a workflow 404 that settles after app deletion succeeds', async () => {
      const appId = 'deleted-app'
      markAppDeletionStarted(appId)
      markAppDeletionSucceeded(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
        ),
      )

      await expect(
        base(`/apps/${appId}/workflows/draft/conversation-variables`),
      ).rejects.toBeInstanceOf(Response)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('should restore workflow 404 notifications when app deletion fails', async () => {
      const appId = 'failed-deletion-app'
      markAppDeletionStarted(appId)
      markAppDeletionFailed(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'not_found',
            message: 'Visible error',
            status: 404,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

      await expect(base(`/apps/${appId}/workflows/draft/variables`)).rejects.toBeInstanceOf(
        Response,
      )
      expect(toast.error).toHaveBeenCalledWith('Visible error')
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
    ])('should still display $title while an app is being deleted', async ({ path, status }) => {
      const appId = 'deleting-app'
      markAppDeletionStarted(appId)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'request_failed',
            message: 'Visible error',
            status,
          }),
          {
            status,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

      try {
        await expect(base(path)).rejects.toBeInstanceOf(Response)
        expect(toast.error).toHaveBeenCalledWith('Visible error')
      } finally {
        markAppDeletionFailed(appId)
      }
    })
  })
})
