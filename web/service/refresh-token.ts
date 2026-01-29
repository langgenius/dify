import { API_PREFIX } from '@/config'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { fetchWithRetry } from '@/utils'
import { storage } from '@/utils/storage'

let isRefreshing = false
function waitUntilTokenRefreshed() {
  return new Promise<void>((resolve) => {
    function _check() {
      const isRefreshingSign = storage.get<string>(STORAGE_KEYS.AUTH.REFRESH_LOCK)
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
  const lastTime = storage.get<string>(STORAGE_KEYS.AUTH.LAST_REFRESH_TIME) || '0'
  return nowTime - Number.parseInt(lastTime) <= delta
}

async function getNewAccessToken(timeout: number): Promise<void> {
  try {
    const isRefreshingSign = storage.get<string>(STORAGE_KEYS.AUTH.REFRESH_LOCK)
    if ((isRefreshingSign && isRefreshingSign === '1' && isRefreshingSignAvailable(timeout)) || isRefreshing) {
      await waitUntilTokenRefreshed()
    }
    else {
      isRefreshing = true
      storage.set(STORAGE_KEYS.AUTH.REFRESH_LOCK, '1')
      storage.set(STORAGE_KEYS.AUTH.LAST_REFRESH_TIME, new Date().getTime().toString())
      globalThis.addEventListener('beforeunload', releaseRefreshLock)

      const [error, ret] = await fetchWithRetry(globalThis.fetch(`${API_PREFIX}/refresh-token`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json;utf-8',
        },
      }))
      if (error) {
        return Promise.reject(error)
      }
      else {
        if (ret.status === 401)
          return Promise.reject(ret)
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
  isRefreshing = false
  storage.remove(STORAGE_KEYS.AUTH.REFRESH_LOCK)
  storage.remove(STORAGE_KEYS.AUTH.LAST_REFRESH_TIME)
  globalThis.removeEventListener('beforeunload', releaseRefreshLock)
}

export async function refreshAccessTokenOrRelogin(timeout: number) {
  return Promise.race([new Promise<void>((resolve, reject) => setTimeout(() => {
    releaseRefreshLock()
    reject(new Error('request timeout'))
  }, timeout)), getNewAccessToken(timeout)])
}
