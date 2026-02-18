'use client'

import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { useEventEmitter } from 'ahooks'
import { createContext, useContext } from 'use-context-selector'

/**
 * Typed event object emitted via the shared EventEmitter.
 * Covers workflow updates, prompt-editor commands, DSL export checks, etc.
 */
export type EventEmitterMessage = {
  type: string
  payload?: unknown
  instanceId?: string
}

export type EventEmitterValue = string | EventEmitterMessage

const EventEmitterContext = createContext<{ eventEmitter: EventEmitter<EventEmitterValue> | null }>({
  eventEmitter: null,
})

export const useEventEmitterContextContext = () => useContext(EventEmitterContext)

type EventEmitterContextProviderProps = {
  children: React.ReactNode
}
export const EventEmitterContextProvider = ({
  children,
}: EventEmitterContextProviderProps) => {
  const eventEmitter = useEventEmitter<EventEmitterValue>()

  return (
    <EventEmitterContext.Provider value={{ eventEmitter }}>
      {children}
    </EventEmitterContext.Provider>
  )
}

export default EventEmitterContext
