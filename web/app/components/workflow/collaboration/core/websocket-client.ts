import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

export type WebSocketConfig = {
  url?: string
  token?: string
  transports?: string[]
  withCredentials?: boolean
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

/**
 * App-specific WebSocket client
 * Provides a clean API for a specific app's WebSocket operations
 */
export class AppWebSocketClient {
  constructor(
    private appId: string,
    private socket: Socket,
    private manager: WebSocketClient,
  ) {
    // Initialize app-specific WebSocket client
  }

  /**
   * Listen to events
   */
  on(event: string, handler: (...args: any[]) => void): () => void {
    this.socket.on(event, handler)
    return () => this.socket.off(event, handler)
  }

  /**
   * Remove event listener
   */
  off(event: string, handler?: (...args: any[]) => void): void {
    this.socket.off(event, handler)
  }

  /**
   * Emit event
   */
  emit(event: string, ...args: any[]): void {
    if (this.socket.connected)
      this.socket.emit(event, ...args)
  }

  /**
   * Check connection status
   */
  get connected(): boolean {
    return this.socket.connected
  }

  /**
   * Get socket ID
   */
  get id(): string | undefined {
    return this.socket.id
  }

  /**
   * Disconnect this specific app
   */
  disconnect(): void {
    this.manager.disconnect(this.appId)
  }

  /**
   * Get the underlying socket (for advanced usage)
   */
  getSocket(): Socket {
    return this.socket
  }
}

/**
 * Multi-connection WebSocket manager
 * Supports multiple concurrent connections for different apps
 */
export class WebSocketClient {
  private connections: Map<string, Socket> = new Map()
  private connecting: Set<string> = new Set()
  private config: WebSocketConfig

  constructor(config: WebSocketConfig = {}) {
    this.config = {
      url: config.url || process.env.NEXT_PUBLIC_SOCKET_URL || 'ws://localhost:5001',
      transports: config.transports || ['websocket'],
      withCredentials: config.withCredentials !== false,
      ...config,
    }
  }

  /**
   * Get or create app-specific WebSocket client
   */
  getClient(appId: string): AppWebSocketClient {
    let socket = this.connections.get(appId)

    if (!socket || !socket.connected)
      socket = this.connect(appId)

    return new AppWebSocketClient(appId, socket, this)
  }

  /**
   * Connect to WebSocket server for specific app
   */
  private connect(appId: string): Socket {
    // Return existing connection if available and connected
    const existingSocket = this.connections.get(appId)
    if (existingSocket?.connected)
      return existingSocket

    // If already connecting, return the pending socket
    if (this.connecting.has(appId)) {
      const pendingSocket = this.connections.get(appId)
      if (pendingSocket)
        return pendingSocket
    }

    // Clean up disconnected socket
    if (existingSocket && !existingSocket.connected) {
      existingSocket.disconnect()
      this.connections.delete(appId)
    }

    // Mark as connecting to prevent duplicate connections
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

  /**
   * Disconnect from specific app or all connections
   */
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
      // Disconnect all connections
      this.connections.forEach(socket => socket.disconnect())
      this.connections.clear()
      this.connecting.clear()
    }
  }

  /**
   * Get socket instance for specific app (for backward compatibility)
   */
  getSocket(appId: string): Socket | null {
    return this.connections.get(appId) || null
  }

  /**
   * Check connection status for specific app
   */
  isConnected(appId: string): boolean {
    return this.connections.get(appId)?.connected || false
  }

  /**
   * Get all connected app IDs
   */
  getConnectedApps(): string[] {
    const connectedApps: string[] = []
    this.connections.forEach((socket, appId) => {
      if (socket.connected)
        connectedApps.push(appId)
    })
    return connectedApps
  }

  /**
   * Debug method: get connection status for all apps
   */
  getDebugInfo(): Record<string, { connected: boolean; connecting: boolean; socketId?: string }> {
    const info: Record<string, { connected: boolean; connecting: boolean; socketId?: string }> = {}

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
      console.log(`WebSocket connected for app: ${appId}`)
    })

    socket.on('disconnect', () => {
      this.connecting.delete(appId)
      console.log(`WebSocket disconnected for app: ${appId}`)
    })

    socket.on('connect_error', (err) => {
      this.connecting.delete(appId)
      console.error(`WebSocket connection error for app ${appId}:`, err)
    })
  }
}

// Singleton instance
export const webSocketClient = new WebSocketClient()

// Online users API
export const fetchAppsOnlineUsers = async (appIds: string[]) => {
  const response = await fetch(`/api/online-users?${new URLSearchParams({
    app_ids: appIds.join(','),
  })}`)
  return response.json()
}
