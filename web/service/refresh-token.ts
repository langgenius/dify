import Cookies from 'js-cookie'
import { v4 as uuidV4, v5 as uuidV5 } from 'uuid'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { isClient } from '@/utils/client'
import { httpErrorFromResponse, isHttpErrorStatus } from './http-error'

const REFRESH_KEY = `refresh-token:${API_PREFIX}`
const REQUEST_TIMEOUT = 4000
let refreshPromise: Promise<void> | undefined

async function requestRefresh(requestId: string, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    // The normal request helper would recursively refresh on an unauthorized response.
    return await globalThis.fetch(`${API_PREFIX}/refresh-token`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Refresh-Request-ID': requestId,
        [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function getNewAccessToken(): Promise<void> {
  const csrfToken = Cookies.get(CSRF_COOKIE_NAME())
  const refresh = async () => {
    // The cookie store updates before fetch resolves; localStorage can lag across tabs.
    if (Cookies.get(CSRF_COOKIE_NAME()) !== csrfToken) return

    // Tabs without Web Locks must identify the same cookie generation as one refresh.
    const requestId = csrfToken ? uuidV5(csrfToken, uuidV5.URL) : uuidV4()
    const retryDeadline = Date.now() + REQUEST_TIMEOUT * 2
    let response: Response
    try {
      response = await requestRefresh(requestId)
    } catch (error) {
      const remaining = retryDeadline - Date.now()
      if (remaining <= 0) throw error
      // Reuse the ID so a lost response cannot rotate the session twice.
      response = await requestRefresh(requestId, Math.min(REQUEST_TIMEOUT, remaining))
    }
    if (isHttpErrorStatus(response.status)) throw await httpErrorFromResponse(response)
  }

  if (navigator.locks) await navigator.locks.request(REFRESH_KEY, refresh)
  else await refresh()
}

export async function refreshAccessTokenOrReLogin(timeout: number): Promise<void> {
  if (!isClient) throw new Error('refresh token is client-only')

  refreshPromise ??= getNewAccessToken().finally(() => {
    refreshPromise = undefined
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      refreshPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('request timeout')), timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
