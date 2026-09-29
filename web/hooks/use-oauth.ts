'use client'
import { useEffect, useState } from 'react'
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
  // The first render must be identical on the server and client. Browser
  // state and callback URL parameters are read only after hydration.
  const [state, setState] = useState<OAuthCallbackState>({
    hasOpener: false,
    finished: false,
    error: null,
    errorDescription: null,
  })

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const subscriptionId = urlParams.get('subscription_id')
    const error = urlParams.get('error')
    const errorDescription = urlParams.get('error_description')
    const opener = window.opener

    setState({
      hasOpener: !!opener,
      finished: true,
      error,
      errorDescription,
    })
    if (!opener) return

    // Use window.opener.origin instead of '*' for security.
    const targetOrigin = opener.origin || '*'

    if (subscriptionId) {
      opener.postMessage({ type: 'oauth_callback', success: true, subscriptionId }, targetOrigin)
    } else if (error) {
      opener.postMessage(
        { type: 'oauth_callback', success: false, error, errorDescription },
        targetOrigin,
      )
    } else {
      opener.postMessage({ type: 'oauth_callback' }, targetOrigin)
    }
    window.close()
  }, [])

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
