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
})
