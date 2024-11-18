'use client'

import { useEventEmitter } from 'ahooks'
import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { createSelectorCtx } from '@/utils/context'

const [, useEventEmitterContextContext, EventEmitterContext] = createSelectorCtx<{ eventEmitter: EventEmitter<string> }>()

export { useEventEmitterContextContext }

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
