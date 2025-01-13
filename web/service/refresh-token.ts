import { apiPrefix } from '@/config'
import { fetchWithRetry } from '@/utils'

const LOCAL_STORAGE_KEY = 'is_other_tab_refreshing'

let isRefreshing = false
function waitUntilTokenRefreshed() {
  return new Promise<void>((resolve, reject) => {
    function _check() {
      const isRefreshingSign = globalThis.localStorage.getItem(LOCAL_STORAGE_KEY)
      if ((isRefreshingSign && isRefreshingSign === '1') || isRefreshing) {
        setTimeout(() => {
          _check()
        }, 1000)
      }
      else {
        resolve()
      }
    }
    _check()
  })
}

const isRefreshingSignAvailable = function (delta: number) {
  const nowTime = new Date().getTime()
  const lastTime = globalThis.localStorage.getItem('last_refresh_time') || '0'
  return nowTime - parseInt(lastTime) <= delta
}

// only one request can send
async function getNewAccessToken(timeout: number): Promise<void> {
  try {
    const isRefreshingSign = globalThis.localStorage.getItem(LOCAL_STORAGE_KEY)
    if ((isRefreshingSign && isRefreshingSign === '1' && isRefreshingSignAvailable(timeout)) || isRefreshing) {
      await waitUntilTokenRefreshed()
    }
    else {
      isRefreshing = true
      globalThis.localStorage.setItem(LOCAL_STORAGE_KEY, '1')
      globalThis.localStorage.setItem('last_refresh_time', new Date().getTime().toString())
      globalThis.addEventListener('beforeunload', releaseRefreshLock)
      const refresh_token = globalThis.localStorage.getItem('refresh_token')

      // Do not use baseFetch to refresh tokens.
      // If a 401 response occurs and baseFetch itself attempts to refresh the token,
      // it can lead to an infinite loop if the refresh attempt also returns 401.
      // To avoid this, handle token refresh separately in a dedicated function
      // that does not call baseFetch and uses a single retry mechanism.
      const [error, ret] = await fetchWithRetry(globalThis.fetch(`${apiPrefix}/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;utf-8',
        },
        body: JSON.stringify({ refresh_token }),
      }))
      if (error) {
        return Promise.reject(error)
      }
      else {
        if (ret.status === 401)
          return Promise.reject(ret)

        const { data } = await ret.json()
        globalThis.localStorage.setItem('console_token', data.access_token)
        globalThis.localStorage.setItem('refresh_token', data.refresh_token)
      }
    }
  }
  catch (error) {
    console.error(error)
    return Promise.reject(error)
  }
  finally {
    releaseRefreshLock()
  }
}

function releaseRefreshLock() {
  if (isRefreshing) {
    isRefreshing = false
    globalThis.localStorage.removeItem(LOCAL_STORAGE_KEY)
    globalThis.localStorage.removeItem('last_refresh_time')
    globalThis.removeEventListener('beforeunload', releaseRefreshLock)
  }
}

export async function refreshAccessTokenOrRelogin(timeout: number) {
  return Promise.race([new Promise<void>((resolve, reject) => setTimeout(() => {
    releaseRefreshLock()
    reject(new Error('request timeout'))
  }, timeout)), getNewAccessToken(timeout)])
}
