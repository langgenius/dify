export type EventHandler<T = any> = (data: T) => void

export class EventEmitter {
  private events: Map<string, Set<EventHandler>> = new Map()

  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    if (!this.events.has(event))
      this.events.set(event, new Set())

    this.events.get(event)!.add(handler)

    return () => this.off(event, handler)
  }

  off<T = any>(event: string, handler?: EventHandler<T>): void {
    if (!this.events.has(event)) return

    const handlers = this.events.get(event)!
    if (handler)
      handlers.delete(handler)
    else
      handlers.clear()

    if (handlers.size === 0)
      this.events.delete(event)
  }

  emit<T = any>(event: string, data: T): void {
    if (!this.events.has(event)) return

    const handlers = this.events.get(event)!
    handlers.forEach((handler) => {
      try {
        handler(data)
      }
      catch (error) {
        console.error(`Error in event handler for ${event}:`, error)
      }
    })
  }

  removeAllListeners(): void {
    this.events.clear()
  }

  getListenerCount(event: string): number {
    return this.events.get(event)?.size || 0
  }
}
