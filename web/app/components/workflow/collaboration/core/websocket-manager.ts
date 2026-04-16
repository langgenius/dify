import type { Socket } from 'socket.io-client'
import type { DebugInfo, WebSocketConfig } from '../types/websocket'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '@/config'

type AckArgs = unknown[]

const isUnauthorizedAck = (...ackArgs: AckArgs): boolean => {
  const [first, second] = ackArgs

  if (second === 401 || first === 401)
    return true

  if (first && typeof first === 'object' && 'msg' in first) {
    const message = (first as { msg?: unknown }).msg
    return message === 'unauthorized'
  }

  return false
}

export type EmitAckOptions = {
  onAck?: (...ackArgs: AckArgs) => void
  onUnauthorized?: (...ackArgs: AckArgs) => void
}

export const emitWithAuthGuard = (
  socket: Socket | null | undefined,
  event: string,
  payload: unknown,
  options?: EmitAckOptions,
): void => {
  if (!socket)
    return

  socket.emit(
    event,
    payload,
    (...ackArgs: AckArgs) => {
      options?.onAck?.(...ackArgs)
      if (isUnauthorizedAck(...ackArgs))
        options?.onUnauthorized?.(...ackArgs)
    },
  )
}

export class WebSocketClient {
  private connections: Map<string, Socket> = new Map()
  private connecting: Set<string> = new Set()
  private readonly url: string
  private readonly transports: WebSocketConfig['transports']
  private readonly withCredentials?: boolean

  constructor(config: WebSocketConfig = {}) {
    this.url = SOCKET_URL
    this.transports = config.transports || ['websocket']
    this.withCredentials = config.withCredentials !== false
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

    const socketOptions: {
      path: string
      transports: WebSocketConfig['transports']
      withCredentials?: boolean
    } = {
      path: '/socket.io',
      transports: this.transports,
      withCredentials: this.withCredentials,
    }

    const socket = io(this.url, socketOptions)

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
      emitWithAuthGuard(socket, 'user_connect', { workflow_id: appId })
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
