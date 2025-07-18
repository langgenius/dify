'use client'
import { get } from '../base'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

let socket: Socket | null = null
let lastAppId: string | null = null

export function connectOnlineUserWebSocket(appId: string): Socket {
  if (socket && lastAppId === appId)
    return socket
  if (socket)
    socket.disconnect()

  const url = process.env.NEXT_PUBLIC_SOCKET_URL || 'ws://localhost:5001'
  const token = localStorage.getItem('console_token')

  socket = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token },
    withCredentials: true,
  })

  lastAppId = appId

  // Add your event listeners here
  socket.on('connect', () => {
    socket?.emit('user_connect', { workflow_id: appId })
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

export const getOnlineUsersSocket = (): Socket | null => {
  return socket
}

export type OnlineUser = {
  user_id: string
  username: string
  avatar: string
  sid: string
}

export type WorkflowOnlineUsers = {
  workflow_id: string
  users: OnlineUser[]
}

export type OnlineUserListResponse = {
  data: WorkflowOnlineUsers[]
}

export const fetchAppsOnlineUsers = (appIds: string[]) => {
  return get<OnlineUserListResponse>('/online-users', {
    params: { app_ids: appIds.join(',') },
  })
}
