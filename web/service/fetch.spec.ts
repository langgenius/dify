import { beforeEach, describe, expect, it, vi } from 'vitest'
import { base, postWithKeepalive } from './fetch'
import { setCurrentWorkspaceId } from './workspace-id-header'

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
    setCurrentWorkspaceId('')
  })

  describe('Workspace header', () => {
    it('should attach the current workspace id to Dify API requests', async () => {
      // Arrange
      setCurrentWorkspaceId('tenant-id')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        JSON.stringify({ result: 'success' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ))

      // Act
      await base('/apps')

      // Assert
      const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]!
      expect(new Headers(requestInit?.headers).get('X-Workspace-Id')).toBe('tenant-id')
    })

    it('should not attach the current workspace id to Marketplace API requests', async () => {
      // Arrange
      setCurrentWorkspaceId('tenant-id')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        JSON.stringify({ result: 'success' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ))

      // Act
      await base('/plugins', {}, { isMarketplaceAPI: true })

      // Assert
      const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]!
      expect(new Headers(requestInit?.headers).has('X-Workspace-Id')).toBe(false)
    })

    it('should attach the current workspace id to keepalive requests', () => {
      // Arrange
      setCurrentWorkspaceId('tenant-id')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

      // Act
      postWithKeepalive('/apps/app-1/draft', { foo: 'bar' })

      // Assert
      const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]!
      expect(new Headers(requestInit?.headers).get('X-Workspace-Id')).toBe('tenant-id')
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
      }
      catch (error) {
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
