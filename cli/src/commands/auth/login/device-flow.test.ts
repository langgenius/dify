import type { CodeResponse, PollRequest, PollResult, PollSuccess } from '../../../api/oauth-device.js'
import type { Clock } from './device-flow.js'
import { describe, expect, it, vi } from 'vitest'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import {
  awaitAuthorization,
  DEFAULT_INTERVAL_MS,
  MAX_INTERVAL_MS,
  POLL_RETRY_ATTEMPTS,
  POLL_RETRY_CAP_MS,
  POLL_RETRY_INITIAL_MS,
} from './device-flow.js'

const successPayload: PollSuccess = {
  token: 'dfoa_xyz',
  account: { id: 'a', email: 'e', name: 'n' },
  workspaces: [{ id: 'w', name: 'W', role: 'owner' }],
  default_workspace_id: 'w',
  token_id: 't',
}

class FakeClock implements Clock {
  sleeps: number[] = []
  cancelled = false
  cancelAt: number | undefined

  async sleepMs(ms: number): Promise<void> {
    this.sleeps.push(ms)
    if (this.cancelAt !== undefined && this.sleeps.length >= this.cancelAt)
      this.cancelled = true
  }

  isCancelled(): boolean {
    return this.cancelled
  }
}

function fakeApi(scripted: PollResult[]): { pollOnce: (req: PollRequest) => Promise<PollResult> } {
  let i = 0
  return {
    pollOnce: async () => {
      const r = scripted[i++]
      if (r === undefined)
        throw new Error('scripted-api: out of responses')
      return r
    },
  }
}

const code: CodeResponse = {
  device_code: 'dc',
  user_code: 'ABCD-1234',
  verification_uri: 'https://dify.example/device',
  expires_in: 900,
  interval: 1,
}

describe('awaitAuthorization', () => {
  it('returns success on first approved poll', async () => {
    const api = fakeApi([{ status: 'approved', success: successPayload }])
    const clock = new FakeClock()
    const result = await awaitAuthorization(api, code, { clock })
    expect(result.token).toBe('dfoa_xyz')
    expect(clock.sleeps).toHaveLength(0)
  })

  it('keeps polling on pending then returns approved', async () => {
    const api = fakeApi([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'approved', success: successPayload },
    ])
    const clock = new FakeClock()
    const result = await awaitAuthorization(api, code, { clock })
    expect(result.token).toBe('dfoa_xyz')
    expect(clock.sleeps).toEqual([1000, 1000])
  })

  it('doubles interval on slow_down (capped at max)', async () => {
    const api = fakeApi([
      { status: 'slow_down' },
      { status: 'slow_down' },
      { status: 'approved', success: successPayload },
    ])
    const clock = new FakeClock()
    const result = await awaitAuthorization(api, code, { clock })
    expect(result.token).toBe('dfoa_xyz')
    expect(clock.sleeps).toEqual([2000, 4000])
  })

  it('caps interval at MAX_INTERVAL_MS', async () => {
    const api = fakeApi([
      { status: 'slow_down' },
      { status: 'slow_down' },
      { status: 'slow_down' },
      { status: 'slow_down' },
      { status: 'slow_down' },
      { status: 'slow_down' },
      { status: 'slow_down' },
      { status: 'approved', success: successPayload },
    ])
    const clock = new FakeClock()
    await awaitAuthorization(api, { ...code, interval: 10 }, { clock })
    const last = clock.sleeps[clock.sleeps.length - 1]!
    expect(last).toBe(MAX_INTERVAL_MS)
  })

  it('throws BaseError on expired', async () => {
    const api = fakeApi([{ status: 'expired' }])
    const clock = new FakeClock()
    await expect(awaitAuthorization(api, code, { clock })).rejects.toThrow(/expired/)
  })

  it('throws BaseError on denied', async () => {
    const api = fakeApi([{ status: 'denied' }])
    const clock = new FakeClock()
    await expect(awaitAuthorization(api, code, { clock })).rejects.toThrow(/denied/)
  })

  it('uses default interval when CodeResponse.interval is 0', async () => {
    const api = fakeApi([
      { status: 'pending' },
      { status: 'approved', success: successPayload },
    ])
    const clock = new FakeClock()
    await awaitAuthorization(api, { ...code, interval: 0 }, { clock })
    expect(clock.sleeps[0]).toBe(DEFAULT_INTERVAL_MS)
  })

  it('rejects when clock signals cancelled', async () => {
    const api = fakeApi([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'pending' },
      { status: 'pending' },
      { status: 'approved', success: successPayload },
    ])
    const clock = new FakeClock()
    clock.cancelAt = 2
    await expect(awaitAuthorization(api, code, { clock })).rejects.toThrow(/expired|cancel/)
  })

  it('exposes constants matching Go reference', () => {
    expect(POLL_RETRY_ATTEMPTS).toBe(5)
    expect(POLL_RETRY_INITIAL_MS).toBe(1000)
    expect(POLL_RETRY_CAP_MS).toBe(16_000)
    expect(MAX_INTERVAL_MS).toBe(60_000)
    expect(DEFAULT_INTERVAL_MS).toBe(5000)
  })

  it('preserves dfoe_ token kind through state machine', async () => {
    const externalSuccess: PollSuccess = {
      token: 'dfoe_xxx',
      subject_type: 'external_sso',
      subject_email: 'sso@x.com',
      subject_issuer: 'https://issuer',
    }
    const api = fakeApi([{ status: 'approved', success: externalSuccess }])
    const clock = new FakeClock()
    const result = await awaitAuthorization(api, code, { clock })
    expect(result.token).toBe('dfoe_xxx')
    expect(result.subject_type).toBe('external_sso')
  })

  it('propagates BaseError thrown by api.pollOnce', async () => {
    const api = {
      pollOnce: vi.fn().mockRejectedValue(new BaseError({ code: ErrorCode.UnsupportedEndpoint, message: 'old server' })),
    }
    const clock = new FakeClock()
    await expect(awaitAuthorization(api, code, { clock })).rejects.toThrow(/old server/)
  })
})
