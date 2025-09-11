'use client'

import { createContext, use } from 'react'
import { useEventEmitter } from 'ahooks'
import type { EventEmitter } from 'ahooks/lib/useEventEmitter'

const EventEmitterContext = createContext<{ eventEmitter: EventEmitter<string> | null }>({
  eventEmitter: null,
})

export const useEventEmitterContextContext = () => use(EventEmitterContext)

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
