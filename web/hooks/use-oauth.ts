'use client'
import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

export const useOAuthCallback = () => {
  const searchParams = useSearchParams()

  useEffect(() => {
    const MCPProviderID = searchParams.get('mcp_provider_id')

    if (MCPProviderID && window.opener) {
      window.opener.postMessage({
        type: 'oauth_callback',
        payload: {
          state: MCPProviderID,
        },
      }, '*')
      window.close()
    }
  }, [searchParams])
}

export const openOAuthPopup = (url: string, callback: (state: string) => void) => {
  const width = 600
  const height = 600
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2

  const popup = window.open(
    url,
    'OAuth',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
  )

  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'oauth_callback') {
      window.removeEventListener('message', handleMessage)
      const { state } = event.data.payload
      callback(state)
    }
  }

  window.addEventListener('message', handleMessage)
  return popup
}
