import { describe, expect, it } from 'vite-plus/test'
import { httpErrorFromResponse } from '@/service/http-error'
import { getServerErrorMessage } from '../error-message'

describe('business error feedback', () => {
  it.each([
    { message: 'Quota exceeded', error: 'legacy fallback' },
    { message: '', error: 'Quota exceeded' },
  ])('preserves backend feedback for an unsuccessful request', async (body) => {
    const error = await httpErrorFromResponse(Response.json(body, { status: 429 }))

    expect(getServerErrorMessage(error)).toBe('Quota exceeded')
  })

  it('leaves authentication recovery and transport failures to their existing owners', async () => {
    const unauthorized = await httpErrorFromResponse(
      Response.json({ message: 'Session expired' }, { status: 401 }),
    )
    const proxyError = await httpErrorFromResponse(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    )

    for (const error of [
      unauthorized,
      proxyError,
      new TypeError('Failed to fetch'),
      new DOMException('Cancelled', 'AbortError'),
    ])
      expect(getServerErrorMessage(error)).toBeUndefined()
  })
})
