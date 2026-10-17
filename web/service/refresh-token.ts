import Cookies from 'js-cookie'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { isClient } from '@/utils/client'
import { httpErrorFromResponse, isHttpErrorStatus } from './http-error'
import {
  getRefreshRequestId,
  REFRESH_REQUEST_ID_HEADER,
  sendRefreshTokenRequest,
} from './refresh-token-request'

let refreshPromise: Promise<void> | undefined

async function getNewAccessToken(): Promise<void> {
  const csrfToken = Cookies.get(CSRF_COOKIE_NAME())
  const refresh = async () => {
    // The cookie store updates before fetch resolves; localStorage can lag across tabs.
    if (Cookies.get(CSRF_COOKIE_NAME()) !== csrfToken) return

    // Tabs without Web Locks must identify the same cookie generation as one refresh.
    const requestId = getRefreshRequestId(csrfToken)
    const response = await sendRefreshTokenRequest((signal) =>
      // The normal request helper would recursively refresh on an unauthorized response.
      globalThis.fetch(`${API_PREFIX}/refresh-token`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          [REFRESH_REQUEST_ID_HEADER]: requestId,
          // A lost response may still have rotated the cookie; send the current generation.
          [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
        },
        signal,
      }),
    )
    if (isHttpErrorStatus(response.status)) throw await httpErrorFromResponse(response)
  }

  if (navigator.locks) await navigator.locks.request(`refresh-token:${API_PREFIX}`, refresh)
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
