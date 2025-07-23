import { useEffect, useState } from 'react'
import { useWebSocketStore } from '@/app/components/workflow/store/websocket-store'

export function useCollaborativeCursors(appId: string) {
  const [cursors, setCursors] = useState<Record<string, any>>({})
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const { getSocket, on } = useWebSocketStore()

  useEffect(() => {
    if (!appId) return

    const socket = getSocket(appId)

    const handleConnect = () => {
      setMyUserId(socket.id || 'unknown')
    }

    const unsubscribeMouseMove = on('mouseMove', (update: any) => {
      if (update.userId !== myUserId) {
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

    if (socket.connected)
      handleConnect()
     else
      socket.on('connect', handleConnect)

    return () => {
      unsubscribeMouseMove()
      socket.off('connect', handleConnect)
    }
  }, [appId, getSocket, on, myUserId])

  return { cursors, myUserId }
}
