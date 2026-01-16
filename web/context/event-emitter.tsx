'use client'

import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { useEventEmitter } from 'ahooks'
import { createContext, useContext } from 'use-context-selector'

const EventEmitterContext = createContext<{ eventEmitter: EventEmitter<string> | null }>({
  eventEmitter: null,
})

export const useEventEmitterContextContext = () => useContext(EventEmitterContext)

type EventEmitterContextProviderProps = {
  children: React.ReactNode
}
export const EventEmitterContextProvider = ({
  children,
}: EventEmitterContextProviderProps) => {
  const eventEmitter = useEventEmitter<string>()

  return (
    <EventEmitterContext.Provider value={{ eventEmitter }}>
      {children}
    </EventEmitterContext.Provider>
  )
}

export default EventEmitterContext
