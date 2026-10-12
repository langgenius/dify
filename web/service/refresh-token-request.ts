import { v4 as uuidV4, v5 as uuidV5 } from 'uuid'

export const REFRESH_REQUEST_ID_HEADER = 'X-Refresh-Request-ID'

// The API replays a lost refresh response for 10 seconds; both attempts must finish inside it.
const ATTEMPT_TIMEOUT = 4000
const RETRY_DEADLINE = ATTEMPT_TIMEOUT * 2

/**
 * Browser tabs and server-rendered refreshes holding the same CSRF cookie generation must send
 * the same ID, so the API replays one rotation instead of revoking the session for token reuse.
 */
export function getRefreshRequestId(csrfToken: string | null | undefined) {
  return csrfToken ? uuidV5(csrfToken, uuidV5.URL) : uuidV4()
}

async function sendWithTimeout(
  send: (signal: AbortSignal) => Promise<Response>,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await send(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Retry a lost response once; `send` must reuse its request ID so the session rotates only once. */
export async function sendRefreshTokenRequest(
  send: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const retryDeadline = Date.now() + RETRY_DEADLINE
  try {
    return await sendWithTimeout(send, ATTEMPT_TIMEOUT)
  } catch (error) {
    // A suspended browser can resume after the API stops replaying the response.
    const remaining = retryDeadline - Date.now()
    if (remaining <= 0) throw error
    return sendWithTimeout(send, Math.min(ATTEMPT_TIMEOUT, remaining))
  }
}
