import { create } from 'zustand'
import { connectOnlineUserWebSocket, disconnectOnlineUserWebSocket } from '@/service/demo/online-user'

type WebSocketInstance = ReturnType<typeof connectOnlineUserWebSocket>

type WebSocketStore = {
  socket: WebSocketInstance | null
  isConnected: boolean
  listeners: Map<string, Set<(data: any) => void>>

  // Actions
  connect: (appId: string) => void
  disconnect: () => void
  emit: (eventType: string, data: any) => void
  on: (eventType: string, handler: (data: any) => void) => () => void
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => ({
  socket: null,
  isConnected: false,
  listeners: new Map(),

  connect: (appId: string) => {
    const socket = connectOnlineUserWebSocket(appId)

    socket.on('collaboration_update', (update: {
      type: string
      userId: string
      data: any
      timestamp: number
    }) => {
      const { listeners } = get()
      const eventListeners = listeners.get(update.type)
      if (eventListeners) {
        eventListeners.forEach((handler) => {
          try {
            handler(update)
          }
 catch (error) {
            console.error(`Error in collaboration event handler for ${update.type}:`, error)
          }
        })
      }
    })

    set({ socket, isConnected: true })
  },

  disconnect: () => {
    const { socket } = get()
    if (socket) {
      socket.off('collaboration_update')
      disconnectOnlineUserWebSocket()
    }
    set({ socket: null, isConnected: false, listeners: new Map() })
  },

  emit: (eventType: string, data: any) => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      socket.emit('collaboration_event', {
        type: eventType,
        data,
        timestamp: Date.now(),
      })
    }
  },

  on: (eventType: string, handler: (data: any) => void) => {
    const { listeners } = get()

    if (!listeners.has(eventType))
      listeners.set(eventType, new Set())

    listeners.get(eventType)!.add(handler)

    return () => {
      const currentListeners = get().listeners.get(eventType)
      if (currentListeners) {
        currentListeners.delete(handler)
        if (currentListeners.size === 0)
          get().listeners.delete(eventType)
      }
    }
  },
}))
