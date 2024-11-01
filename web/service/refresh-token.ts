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
      // do not use baseFetch for refresh token, if return 401, request will in a loop
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

export async function refreshAccessTokenOrRelogin() {
  try {
    await getNewAccessToken()
  }
  catch (error) {
    console.error(error)
    return Promise.reject(error)
  }
}
