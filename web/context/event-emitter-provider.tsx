'use client'

import type { ReactNode } from 'react'
import type { EventEmitterValue } from './event-emitter'
import { useEventEmitter } from 'ahooks'
import { EventEmitterContext } from './event-emitter'

type EventEmitterContextProviderProps = {
  children: ReactNode
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
