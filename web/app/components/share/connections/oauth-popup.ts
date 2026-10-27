'use client'

type AuthorizationOptions = {
  signal?: AbortSignal
  callbackOrigin?: string
}

export function authorizeConnection(
  getAuthorizationUrl: () => Promise<{ authorization_url: string }>,
  { signal, callbackOrigin }: AuthorizationOptions = {},
): Promise<string | null> {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason ?? new DOMException('Authorization cancelled.', 'AbortError'),
    )

  return new Promise((resolve, reject) => {
    const width = 600
    const height = 600
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    const candidate = window.open(
      'about:blank',
      '_blank',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
    )
    if (!candidate) {
      reject(new Error('The authorization window could not be opened.'))
      return
    }
    const popup = candidate

    const expectedOrigin = callbackOrigin ?? window.location.origin
    let settled = false
    let checkClosed: number | undefined
    function closePopup() {
      if (!popup.closed) popup.close()
    }
    function cleanup() {
      window.removeEventListener('message', handleMessage)
      if (checkClosed !== undefined) window.clearInterval(checkClosed)
      signal?.removeEventListener('abort', handleAbort)
      closePopup()
    }
    function finish(connectionId: string | null) {
      if (settled) return
      settled = true
      cleanup()
      resolve(connectionId)
    }
    function fail(error: unknown) {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    function handleAbort() {
      fail(signal?.reason ?? new DOMException('Authorization cancelled.', 'AbortError'))
    }
    function handleMessage(event: MessageEvent<unknown>) {
      if (event.source !== popup || event.origin !== expectedOrigin) return
      const data = event.data
      if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'oauth_callback')
        return
      if (('success' in data && data.success === false) || ('error' in data && data.error)) {
        const message =
          'errorDescription' in data &&
          typeof data.errorDescription === 'string' &&
          data.errorDescription.trim()
            ? data.errorDescription
            : 'error' in data && typeof data.error === 'string' && data.error.trim()
              ? data.error
              : 'Authorization failed.'
        fail(new Error(message))
        return
      }
      if (
        'success' in data &&
        data.success === true &&
        'connectionId' in data &&
        typeof data.connectionId === 'string' &&
        data.connectionId.trim()
      )
        finish(data.connectionId.trim())
    }
    checkClosed = window.setInterval(() => {
      if (popup.closed) finish(null)
    }, 250)
    window.addEventListener('message', handleMessage)
    signal?.addEventListener('abort', handleAbort, { once: true })
    if (signal?.aborted) {
      handleAbort()
      return
    }

    try {
      void getAuthorizationUrl()
        .then(({ authorization_url }) => {
          if (settled) return
          if (popup.closed) {
            finish(null)
            return
          }
          const target = new URL(authorization_url)
          if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
            throw new Error('Invalid authorization URL.')
          popup.location.replace(target.href)
        })
        .catch(fail)
    } catch (error) {
      fail(error)
    }
  })
}
