'use client'
import { useEffect } from 'react'
import { validateRedirectUrl } from '@/utils/urlValidation'

export const useOAuthCallback = () => {
  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({
        type: 'oauth_callback',
      }, '*')
      window.close()
    }
  }, [])
}

export const openOAuthPopup = (url: string, callback: () => void) => {
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
      callback()
    }
  }

  window.addEventListener('message', handleMessage)
  return popup
}
