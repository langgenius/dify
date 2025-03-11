'use client'
import { useEffect } from 'react'
const MessageListener = () => {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log('Received message from A:', event.data)
      if(event.data.action === 'auto-login') {
        localStorage.setItem('auto-login', JSON.stringify(event.data.data))
        event.source.postMessage('got', event.origin)
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
