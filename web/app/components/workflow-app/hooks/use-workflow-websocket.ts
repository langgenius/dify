import { useEffect, useState } from 'react'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-client'

export function useCollaborativeCursors(appId: string) {
  const [cursors, setCursors] = useState<Record<string, any>>({})
  const [myUserId, setMyUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!appId) return

    // Get existing socket or create new one
    const wsClient = webSocketClient.getClient(appId)

    const handleConnect = () => {
      setMyUserId(wsClient.id || 'unknown')
    }

    // Listen to collaboration events for this specific app
    const unsubscribeMouseMove = wsClient.on('collaboration_update', (update: any) => {
      if (update.type === 'mouseMove' && update.userId !== myUserId) {
        setCursors(prev => ({
          ...prev,
          [update.userId]: {
            x: update.data.x,
            y: update.data.y,
            userId: update.userId,
            timestamp: update.timestamp,
          },
        }))
      }
    })

    if (wsClient.connected)
      handleConnect()
     else
      wsClient.on('connect', handleConnect)

    return () => {
      unsubscribeMouseMove()
      wsClient.off('connect', handleConnect)
    }
  }, [appId])

  return { cursors, myUserId }
}
