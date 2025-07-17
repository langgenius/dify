'use client'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

let socket: Socket | null = null

/**
 * Connect to the online user websocket server.
 * @param appId The app id to join a specific room or namespace.
 * @returns The socket instance.
 */
export function connectOnlineUserWebSocket(appId: string): Socket {
  // If already connected, disconnect first
  if (socket)
    socket.disconnect()

  const url = process.env.NEXT_PUBLIC_SOCKET_URL || 'ws://localhost:5001'

  socket = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    query: { app_id: appId },
    withCredentials: true,
  })

  // Add your event listeners here
  socket.on('connect', () => {
    console.log('WebSocket connected')
  })

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected')
  })

  socket.on('online_users', (data) => {
    console.log('Online users:', data)
  })

  socket.on('connect_error', (err) => {
    console.error('WebSocket connection error:', err)
  })

  return socket
}

/**
 * Disconnect the websocket connection.
 */
export function disconnectOnlineUserWebSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
