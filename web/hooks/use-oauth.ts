'use client'
import { useEffect } from 'react'
import { validateRedirectUrl } from '@/utils/urlValidation'

export const useOAuthCallback = () => {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const subscriptionId = urlParams.get('subscription_id')
    const error = urlParams.get('error')
    const errorDescription = urlParams.get('error_description')

    if (window.opener) {
      // Use window.opener.origin instead of '*' for security
      const targetOrigin = window.opener?.origin || '*'

      if (subscriptionId) {
        window.opener.postMessage({
          type: 'oauth_callback',
          success: true,
          subscriptionId,
        }, targetOrigin)
      }
      else if (error) {
        window.opener.postMessage({
          type: 'oauth_callback',
          success: false,
          error,
          errorDescription,
        }, targetOrigin)
      }
      else {
        window.opener.postMessage({
          type: 'oauth_callback',
        }, targetOrigin)
      }
      window.close()
    }
  }, [])
}

export const openOAuthPopup = (url: string, callback: (data?: any) => void) => {
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
