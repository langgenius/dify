import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'
import { ACCESS_TOKEN_LOCAL_STORAGE_NAME } from '@/config'
import type { DebugInfo, WebSocketConfig } from '../types/websocket'

export class WebSocketClient {
  private connections: Map<string, Socket> = new Map()
  private connecting: Set<string> = new Set()
  private config: WebSocketConfig

  constructor(config: WebSocketConfig = {}) {
    const inferUrl = () => {
      if (typeof window === 'undefined')
        return 'ws://localhost:5001'
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${scheme}//${window.location.host}`
    }
    this.config = {
      url: config.url || process.env.NEXT_PUBLIC_SOCKET_URL || inferUrl(),
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

    const authToken = typeof window === 'undefined'
      ? undefined
      : window.localStorage.getItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME) ?? undefined

    const socketOptions: {
      path: string
      transports: WebSocketConfig['transports']
      withCredentials?: boolean
      auth?: { token: string }
    } = {
      path: '/socket.io',
      transports: this.config.transports,
      withCredentials: this.config.withCredentials,
    }

    if (authToken)
      socketOptions.auth = { token: authToken }

    const socket = io(this.config.url!, socketOptions)

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
