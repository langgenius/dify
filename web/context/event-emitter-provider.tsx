'use client'

import type { ReactNode } from 'react'
import type { EventEmitterValue } from './event-emitter'
import { useEventEmitter } from 'ahooks'
import { useMemo } from 'react'
import { EventEmitterContext } from './event-emitter'

type EventEmitterContextProviderProps = {
  children: ReactNode
}

export const EventEmitterContextProvider = ({
  children,
}: EventEmitterContextProviderProps) => {
  const eventEmitter = useEventEmitter<EventEmitterValue>()

  const contextValue = useMemo(() => ({
    eventEmitter,
  }), [eventEmitter])

  return (
    <EventEmitterContext.Provider value={contextValue}>
      {children}
    </EventEmitterContext.Provider>
  )
}
