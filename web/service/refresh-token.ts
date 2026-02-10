import { API_PREFIX } from '@/config'
import { fetchWithRetry } from '@/utils'

const LOCAL_STORAGE_KEY = 'is_other_tab_refreshing'
const LAST_REFRESH_TIME_KEY = 'last_refresh_time'
const REFRESH_LOCK_MAX_AGE_MS = 10 * 1000
const REFRESH_LOCK_POLL_INTERVAL_MS = 200

let isRefreshing = false
let refreshLockToken: string | null = null

const getCurrentTime = () => Date.now()

function getRefreshLockAge() {
  const lastTime = globalThis.localStorage.getItem(LAST_REFRESH_TIME_KEY) || '0'
  const parsedLastTime = Number.parseInt(lastTime, 10)
  if (Number.isNaN(parsedLastTime) || parsedLastTime <= 0)
    return Number.POSITIVE_INFINITY

  return getCurrentTime() - parsedLastTime
}

function hasValidRefreshLock() {
  const refreshLock = globalThis.localStorage.getItem(LOCAL_STORAGE_KEY)
  if (!refreshLock)
    return false

  if (getRefreshLockAge() <= REFRESH_LOCK_MAX_AGE_MS)
    return true

  // stale lock from another tab/session: clean it up to avoid deadlock
  globalThis.localStorage.removeItem(LOCAL_STORAGE_KEY)
  globalThis.localStorage.removeItem(LAST_REFRESH_TIME_KEY)
  return false
}

function waitUntilTokenRefreshed(maxWaitMs: number) {
  const startedAt = getCurrentTime()
  return new Promise<void>((resolve) => {
    function _check() {
      if (getCurrentTime() - startedAt >= maxWaitMs) {
        if (!isRefreshing) {
          globalThis.localStorage.removeItem(LOCAL_STORAGE_KEY)
          globalThis.localStorage.removeItem(LAST_REFRESH_TIME_KEY)
        }
        resolve()
        return
      }

      if (hasValidRefreshLock() || isRefreshing) {
        setTimeout(() => {
          _check()
        }, REFRESH_LOCK_POLL_INTERVAL_MS)
      }
      else {
        resolve()
      }
    }
    _check()
  })
}

function acquireRefreshLock() {
  refreshLockToken = `${getCurrentTime()}-${Math.random().toString(36).slice(2)}`
  globalThis.localStorage.setItem(LOCAL_STORAGE_KEY, refreshLockToken)
  globalThis.localStorage.setItem(LAST_REFRESH_TIME_KEY, getCurrentTime().toString())
}

// only one request can send
async function getNewAccessToken(timeout: number): Promise<void> {
  let lockAcquired = false

  try {
    if (hasValidRefreshLock() || isRefreshing) {
      await waitUntilTokenRefreshed(Math.min(timeout, REFRESH_LOCK_MAX_AGE_MS))
      return
    }

    isRefreshing = true
    acquireRefreshLock()
    lockAcquired = true
    globalThis.addEventListener('beforeunload', releaseRefreshLock)

    // Do not use baseFetch to refresh tokens.
    // If a 401 response occurs and baseFetch itself attempts to refresh the token,
    // it can lead to an infinite loop if the refresh attempt also returns 401.
    // To avoid this, handle token refresh separately in a dedicated function
    // that does not call baseFetch and uses a single retry mechanism.
    const [error, ret] = await fetchWithRetry(globalThis.fetch(`${API_PREFIX}/refresh-token`, {
      method: 'POST',
      credentials: 'include', // Important: include cookies in the request
      headers: {
        'Content-Type': 'application/json;utf-8',
      },
      // No body needed - refresh token is in cookie
    }))
    if (error) {
      return Promise.reject(error)
    }
    else {
      if (ret.status === 401)
        return Promise.reject(ret)
    }
  }
  catch (error) {
    console.error(error)
    return Promise.reject(error)
  }
  finally {
    if (lockAcquired)
      releaseRefreshLock()
  }
}

function releaseRefreshLock() {
  const currentLockToken = globalThis.localStorage.getItem(LOCAL_STORAGE_KEY)

  isRefreshing = false
  if (refreshLockToken && currentLockToken === refreshLockToken) {
    globalThis.localStorage.removeItem(LOCAL_STORAGE_KEY)
    globalThis.localStorage.removeItem(LAST_REFRESH_TIME_KEY)
  }

  refreshLockToken = null
  globalThis.removeEventListener('beforeunload', releaseRefreshLock)
}

export async function refreshAccessTokenOrReLogin(timeout: number) {
  return Promise.race([new Promise<void>((resolve, reject) => setTimeout(() => {
    releaseRefreshLock()
    reject(new Error('request timeout'))
  }, timeout)), getNewAccessToken(timeout)])
}
