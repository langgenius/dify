'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
const MessageListener = () => {
  const router = useRouter()
  useEffect(() => {
    localStorage.removeItem('disable_log_out')
    const handleMessage = (event: MessageEvent) => {
      if (event.data.action === 'auto-login') {
        event.source.postMessage('got', event.origin)
        localStorage.setItem('console_token', event.data.data.token)
        localStorage.setItem('refresh_token', event.data.data.refreshToken)
        sessionStorage.setItem('disable_log_out', true)
        window.location.reload()
        router.replace(event.data.src)
      }
      else if(event.data.action === 'clear-token') {
        event.source.postMessage('got', event.origin)
        localStorage.removeItem('console_token')
        localStorage.removeItem('refresh_token')
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  return null
}

export default MessageListener
