import { beforeEach, describe, expect, it, vi } from 'vitest'
// oxlint-disable-next-line no-restricted-imports -- This spec directly tests legacy auth replay.
import { request } from './base'
import { base } from './fetch'

const refreshAccessTokenOrReLoginMock = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    add: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./refresh-token', () => ({
  refreshAccessTokenOrReLogin: refreshAccessTokenOrReLoginMock,
}))

const { toast } = await import('@langgenius/dify-ui/toast')

describe('base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
