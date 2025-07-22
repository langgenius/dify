import { useEffect, useState } from 'react'
import { useWebSocketStore } from '@/app/components/workflow/store/websocket-store'

export function useCollaborativeCursors(appId: string) {
  const { on, connect, disconnect } = useWebSocketStore()
  const [cursors, setCursors] = useState<Record<string, any>>({})
  const [myUserId, setMyUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!appId) return
    connect(appId)

    return () => {
      disconnect()
    }
  }, [appId, connect, disconnect])

  useEffect(() => {
    const unsubscribe = on('mouseMove', (update) => {
      const userId = update.userId || update.user_id
      const data = update.data || update

      if (userId && data) {
        setCursors(prev => ({
          ...prev,
          [userId]: {
            x: data.x,
            y: data.y,
            userId,
          },
        }))
      }
    })

    return unsubscribe
  }, [on])

  useEffect(() => {
    const unsubscribe = on('connected', (data) => {
      if (data.userId || data.user_id)
        setMyUserId(data.userId || data.user_id)
    })

    return unsubscribe
  }, [on])

  return { cursors, myUserId }
}
