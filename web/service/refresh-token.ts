import { apiPrefix } from '@/config'
import { fetchWithRetry } from '@/utils'

let isRefreshing = false
function waitUntilTokenRefreshed() {
  return new Promise<void>((resolve, reject) => {
    function _check() {
      const isRefreshingSign = localStorage.getItem('is_refreshing')
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

// only one request can send
async function getNewAccessToken(): Promise<void> {
  try {
    const isRefreshingSign = localStorage.getItem('is_refreshing')
    if ((isRefreshingSign && isRefreshingSign === '1') || isRefreshing) {
      await waitUntilTokenRefreshed()
    }
    else {
      globalThis.localStorage.setItem('is_refreshing', '1')
      isRefreshing = true
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
    isRefreshing = false
    globalThis.localStorage.removeItem('is_refreshing')
  }
}

export async function refreshAccessTokenOrRelogin(timeout: number) {
  return Promise.race([new Promise<void>((resolve, reject) => setTimeout(() => {
    isRefreshing = false
    globalThis.localStorage.removeItem('is_refreshing')
    reject(new Error('request timeout'))
  }, timeout)), getNewAccessToken()])
}
