import { describe, expect, it } from 'vitest'
import { getDSLImportErrorMessage } from '../dsl-import-error'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 400, headers: { 'Content-Type': 'application/json' } })

describe('getDSLImportErrorMessage', () => {
  it('returns the backend `error` field when present', async () => {
    const message = await getDSLImportErrorMessage(jsonResponse({ error: 'Missing app data' }), 'fallback')
    expect(message).toBe('Missing app data')
  })

  it('falls back to the `message` field when `error` is absent', async () => {
    const message = await getDSLImportErrorMessage(jsonResponse({ message: 'invalid_param' }), 'fallback')
    expect(message).toBe('invalid_param')
  })

  it('returns the fallback when the body has no error fields', async () => {
    const message = await getDSLImportErrorMessage(jsonResponse({ status: 'failed' }), 'fallback')
    expect(message).toBe('fallback')
  })

  it('returns the fallback when the response body is not JSON', async () => {
    const message = await getDSLImportErrorMessage(new Response('<html>oops</html>', { status: 500 }), 'fallback')
    expect(message).toBe('fallback')
  })

  it('returns the fallback for non-Response errors', async () => {
    expect(await getDSLImportErrorMessage(new Error('boom'), 'fallback')).toBe('fallback')
    expect(await getDSLImportErrorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
