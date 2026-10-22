import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceApproveAccount, DeviceFlowError } from '../device-flow'

function stubFetch(status: number, body: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))
}

describe('deviceApproveAccount error codes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the code from an openapi error body', async () => {
    stubFetch(503, JSON.stringify({ code: 'bearer_auth_disabled', message: 'm', status: 503 }))

    const err = await deviceApproveAccount('ABCD-EFGH').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DeviceFlowError)
    expect(err).toMatchObject({ code: 'bearer_auth_disabled', status: 503 })
  })

  it('prefers the legacy error key over code', async () => {
    stubFetch(404, JSON.stringify({ error: 'expired_or_unknown', code: 'not_found' }))

    const err = await deviceApproveAccount('ABCD-EFGH').catch((e: unknown) => e)

    expect(err).toMatchObject({ code: 'expired_or_unknown', status: 404 })
  })

  it('falls back to the status class for a non-JSON body', async () => {
    stubFetch(500, 'oops')

    const err = await deviceApproveAccount('ABCD-EFGH').catch((e: unknown) => e)

    expect(err).toMatchObject({ code: 'server_error', status: 500 })
  })
})
