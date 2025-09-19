import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'
import type { DebugInfo, WebSocketConfig } from '../types/websocket'

export class WebSocketClient {
  private connections: Map<string, Socket> = new Map()
  private connecting: Set<string> = new Set()
  private config: WebSocketConfig

  constructor(config: WebSocketConfig = {}) {
    this.config = {
      url: config.url || process.env.NEXT_PUBLIC_SOCKET_URL || 'wss://api:5001',
      transports: config.transports || ['websocket'],
      withCredentials: config.withCredentials !== false,
      ...config,
    }
  }

  connect(appId: string): Socket {
    const existingSocket = this.connections.get(appId)
    if (existingSocket?.connected)
      return existingSocket

    if (this.connecting.has(appId)) {
      const pendingSocket = this.connections.get(appId)
      if (pendingSocket)
        return pendingSocket
    }

    if (existingSocket && !existingSocket.connected) {
      existingSocket.disconnect()
      this.connections.delete(appId)
    }

    this.connecting.add(appId)

    const authToken = localStorage.getItem('console_token')
    const socket = io(this.config.url!, {
      path: '/socket.io',
      transports: this.config.transports,
      auth: { token: authToken },
      withCredentials: this.config.withCredentials,
    })

    this.connections.set(appId, socket)
    this.setupBaseEventListeners(socket, appId)

    return socket
  }

  disconnect(appId?: string): void {
    if (appId) {
      const socket = this.connections.get(appId)
      if (socket) {
        socket.disconnect()
        this.connections.delete(appId)
        this.connecting.delete(appId)
      }
    }
    else {
      this.connections.forEach(socket => socket.disconnect())
      this.connections.clear()
      this.connecting.clear()
    }
  }

  getSocket(appId: string): Socket | null {
    return this.connections.get(appId) || null
  }

  isConnected(appId: string): boolean {
    return this.connections.get(appId)?.connected || false
  }

  getConnectedApps(): string[] {
    const connectedApps: string[] = []
    this.connections.forEach((socket, appId) => {
      if (socket.connected)
        connectedApps.push(appId)
    })
    return connectedApps
  }

  getDebugInfo(): DebugInfo {
    const info: DebugInfo = {}
    this.connections.forEach((socket, appId) => {
      info[appId] = {
        connected: socket.connected,
        connecting: this.connecting.has(appId),
        socketId: socket.id,
      }
    })
    return info
  }

  private setupBaseEventListeners(socket: Socket, appId: string): void {
    socket.on('connect', () => {
      this.connecting.delete(appId)
      socket.emit('user_connect', { workflow_id: appId })
    })

    socket.on('disconnect', () => {
      this.connecting.delete(appId)
    })

    socket.on('connect_error', () => {
      this.connecting.delete(appId)
    })
  }
}

export const webSocketClient = new WebSocketClient()

export const fetchAppsOnlineUsers = async (appIds: string[]) => {
  const response = await fetch(`/api/online-users?${new URLSearchParams({
    app_ids: appIds.join(','),
  })}`)
  return response.json()
}
