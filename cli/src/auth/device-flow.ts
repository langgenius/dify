import type { CodeResponse, PollRequest, PollResult, PollSuccess } from './device-api'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { isCancelled } from '@/plugins/commands/cancel'
import { DEFAULT_CLIENT_ID } from './device-api'

export const DEFAULT_INTERVAL_MS = 5_000
export const MAX_INTERVAL_MS = 60_000
export const POLL_RETRY_ATTEMPTS = 5
export const POLL_RETRY_INITIAL_MS = 1_000
export const POLL_RETRY_CAP_MS = 16_000

const CANCELLED_MESSAGE = 'cancelled'

export type Clock = {
  sleepMs: (ms: number) => Promise<void>
  isCancelled: () => boolean
}

export type DeviceFlowApiSubset = {
  pollOnce: (req: PollRequest) => Promise<PollResult>
}

export type AwaitOptions = {
  clock: Clock
  clientId?: string
}

export async function awaitAuthorization(
  api: DeviceFlowApiSubset,
  code: CodeResponse,
  opts: AwaitOptions,
): Promise<PollSuccess> {
  if (code.device_code === '') throw expired()

  const baseInterval = code.interval > 0 ? code.interval * 1000 : DEFAULT_INTERVAL_MS
  let interval = baseInterval
  const req: PollRequest = {
    device_code: code.device_code,
    client_id: opts.clientId ?? DEFAULT_CLIENT_ID,
  }

  while (true) {
    if (opts.clock.isCancelled()) throw cancelledError()
    const result = await pollWithRetry(api, req, opts.clock)
    switch (result.status) {
      case 'approved':
        return result.success
      case 'pending':
        break
      case 'slow_down':
        interval = Math.min(interval * 2, MAX_INTERVAL_MS)
        break
      case 'expired':
        throw expired()
      case 'denied':
        throw new BaseError({
          code: ErrorCode.AccessDenied,
          message: 'authorization denied',
        })
      case 'retry_5xx':
        throw new BaseError({
          code: ErrorCode.ServerError,
          message: 'device-flow poll unavailable after retries',
        })
    }
    await opts.clock.sleepMs(interval)
    if (opts.clock.isCancelled()) throw cancelledError()
  }
}

async function pollWithRetry(
  api: DeviceFlowApiSubset,
  req: PollRequest,
  clock: Clock,
): Promise<PollResult> {
  let backoff = POLL_RETRY_INITIAL_MS
  for (let attempt = 1; attempt <= POLL_RETRY_ATTEMPTS; attempt++) {
    const result = await api.pollOnce(req)
    if (result.status !== 'retry_5xx') return result
    if (attempt === POLL_RETRY_ATTEMPTS) break
    await clock.sleepMs(backoff)
    backoff = Math.min(backoff * 2, POLL_RETRY_CAP_MS)
  }
  return { status: 'retry_5xx' }
}

function expired(): BaseError {
  return new BaseError({
    code: ErrorCode.AuthExpired,
    message: 'code expired before authorization',
  })
}

// Ctrl-C during the wait is neither an expiry nor a usage mistake: the code is still
// good, the operator just stopped waiting for it.
function cancelledError(): BaseError {
  return new BaseError({ code: ErrorCode.Unknown, message: CANCELLED_MESSAGE })
}

export function realClock(): Clock {
  return {
    async sleepMs(ms) {
      await new Promise<void>((r) => setTimeout(r, ms))
    },
    isCancelled,
  }
}
