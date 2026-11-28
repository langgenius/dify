import { ORPCError } from '@orpc/client'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { getRequestErrorMessage } from '../http-error'
import { marketplaceClient } from '../marketplace'

vi.mock('../client-error', () => ({ reportClientError: vi.fn() }))

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  )

describe('marketplace client errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('decodes a failed response like the console transport', async () => {
    respond(
      503,
      { code: 'marketplace_unavailable', message: 'Marketplace unavailable' },
      {
        'Retry-After': '30',
      },
    )

    const error = await marketplaceClient.banners
      .list({ query: { page: 'plugins', language: 'en-US' } })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      code: 'marketplace_unavailable',
      status: 503,
      data: { code: 'marketplace_unavailable', message: 'Marketplace unavailable' },
    })
    expect(getRequestErrorMessage(error)).toBe('Marketplace unavailable')
    expect((error as ORPCError<string, unknown>).cause).toMatchObject({
      headers: expect.any(Headers),
    })
  })

  it('keeps the status of a failed response without a JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad gateway', { status: 502 }))

    const error = await marketplaceClient.banners
      .list({ query: { page: 'plugins', language: 'en-US' } })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 502 })
  })
})
