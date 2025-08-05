import { create } from 'zustand'
import { connectOnlineUserWebSocket } from '@/service/demo/online-user'

export type WebSocketInstance = ReturnType<typeof connectOnlineUserWebSocket>

type WebSocketStore = {
  socket: WebSocketInstance | null
  listeners: Map<string, Set<(data: any) => void>>

  isConnected: () => boolean
  getSocket: (appId: string) => WebSocketInstance
  emit: (eventType: string, data: any) => void
  on: (eventType: string, handler: (data: any) => void) => () => void
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => ({
  socket: null,
  listeners: new Map(),

  isConnected: () => {
    const { socket } = get()
    return socket?.connected || false
  },

  getSocket: (appId: string) => {
    let { socket } = get()
    if (!socket) {
      socket = connectOnlineUserWebSocket(appId)

      socket.on('collaboration_update', (update) => {
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

      set({ socket })
    }
    return socket
  },

  emit: (eventType: string, data: any) => {
    const { socket } = get()
    if (socket?.connected) {
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
