import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { base } from './fetch'

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    add: vi.fn(),
    error: vi.fn(),
  },
}))

describe('base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    it('should show the error field when a non-401 response has no message', async () => {
      // Arrange
      const providerErrorResponse = new Response(
        JSON.stringify({
          code: 'provider_error',
          error: 'Provider failure',
          status: 500,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(providerErrorResponse)

      // Act
      await expect(base('/model-provider')).rejects.toBeInstanceOf(Response)

      // Assert
      expect(toast.error).toHaveBeenCalledWith('Provider failure')
    })
  })
})
