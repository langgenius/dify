'use client'
import { useEffect, useMemo } from 'react'
import { validateRedirectUrl } from '@/utils/urlValidation'

export type OAuthCallbackState = {
  /** True when the callback tab/popup was opened by another window via window.open. */
  hasOpener: boolean
  /** True after the callback has posted a message to the opener (or decided not to). */
  finished: boolean
  /** Provider-supplied error code, if any. */
  error: string | null
  /** Provider-supplied error description, if any. */
  errorDescription: string | null
}

export const useOAuthCallback = (): OAuthCallbackState => {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const subscriptionId = urlParams.get('subscription_id')
  const error = urlParams.get('error')
  const errorDescription = urlParams.get('error_description')

  // The state must be available on the first render so the page can decide
  // which UI to render (empty <div /> for the popup path, or a fallback
  // message for the no-opener path) — see #39752. The URL params and the
  // (immutable per page load) presence of window.opener are stable, so the
  // empty dep list is intentional.
  const state: OAuthCallbackState = useMemo(
    () => ({
      hasOpener: !!window.opener,
      finished: true,
      error,
      errorDescription,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    if (!window.opener) return

    // Use window.opener.origin instead of '*' for security
    const targetOrigin = window.opener?.origin || '*'

    if (subscriptionId) {
      window.opener.postMessage(
        {
          type: 'oauth_callback',
          success: true,
          subscriptionId,
        },
        targetOrigin,
      )
    } else if (error) {
      window.opener.postMessage(
        {
          type: 'oauth_callback',
          success: false,
          error,
          errorDescription,
        },
        targetOrigin,
      )
    } else {
      window.opener.postMessage(
        {
          type: 'oauth_callback',
        },
        targetOrigin,
      )
    }
    window.close()
  }, [error, errorDescription, subscriptionId])

  return state
}

type OAuthCallbackMessage = {
  type: 'oauth_callback'
  success?: boolean
  subscriptionId?: string
  error?: string
  errorDescription?: string
}

export const openOAuthPopup = (url: string, callback: (data?: OAuthCallbackMessage) => void) => {
  const width = 600
  const height = 600
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2

  validateRedirectUrl(url)
  const popup = window.open(
    url,
    'OAuth',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
  )

  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'oauth_callback') {
      window.removeEventListener('message', handleMessage)
      callback(event.data)
    }
  }

  window.addEventListener('message', handleMessage)

  // Fallback for window close detection
  const checkClosed = setInterval(() => {
    if (popup?.closed) {
      clearInterval(checkClosed)
      window.removeEventListener('message', handleMessage)
      callback()
    }
  }, 1000)

  return popup
}
