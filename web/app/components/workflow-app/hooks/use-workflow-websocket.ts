import {
  useEffect,
  useRef,
  useState,
} from 'react'

import { connectOnlineUserWebSocket, disconnectOnlineUserWebSocket } from '@/service/demo/online-user'

type Cursor = {
  x: number
  y: number
  userId: string
  name?: string
  color?: string
}

export function useCollaborativeCursors(appId: string) {
  const [cursors, setCursors] = useState<Record<string, Cursor>>({})
  const socketRef = useRef<ReturnType<typeof connectOnlineUserWebSocket> | null>(null)
  const lastSent = useRef<number>(0)

  useEffect(() => {
    // Connect websocket
    const socket = connectOnlineUserWebSocket(appId)
    socketRef.current = socket

    // Listen for collaboration updates from other users
    socket.on('collaboration_update', (update: {
      type: string
      userId: string
      data: any
      timestamp: number
    }) => {
      if (update.type === 'mouseMove') {
        setCursors(prev => ({
          ...prev,
          [update.userId]: {
            x: update.data.x,
            y: update.data.y,
            userId: update.userId,
          },
        }))
      }
      // if (update.type === 'openPanel') { ... }
    })

    // Mouse move handler with throttle 300ms
    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now()
      if (now - lastSent.current > 300) {
        socket.emit('collaboration_event', {
          type: 'mouseMove',
          data: { x: e.clientX, y: e.clientY },
          timestamp: now,
        })
        lastSent.current = now
      }
    }
    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      socket.off('collaboration_update')
      disconnectOnlineUserWebSocket()
    }
  }, [appId])

  return cursors
}
