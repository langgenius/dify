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

    // Listen for other users' cursor updates
    socket.on('users_mouse_positions', (positions: Record<string, Cursor>) => {
      setCursors(positions)
    })

    // Mouse move handler with throttle (e.g. 30ms)
    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now()
      if (now - lastSent.current > 30) {
        socket.emit('mouse_move', { x: e.clientX, y: e.clientY })
        lastSent.current = now
      }
    }
    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      socket.off('users_mouse_positions')
      disconnectOnlineUserWebSocket()
    }
  }, [appId])

  return cursors
}
