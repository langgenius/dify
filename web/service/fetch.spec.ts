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
