import type { Emitter, EventType, Handler, WildcardHandler } from 'mitt'
import create from 'mitt'
import { useEffect, useRef } from 'react'

const merge = <T extends Record<string, any>>(
  ...args: Array<T | undefined>
): T => {
  return Object.assign({}, ...args)
}

export type _Events = Record<EventType, unknown>

export type UseSubscribeOption = {
  /**
   * Whether the subscription is enabled.
   * @default true
   */
  enabled: boolean
}

export type ExtendedOn<Events extends _Events> = {
  <Key extends keyof Events>(
    type: Key,
    handler: Handler<Events[Key]>,
    options?: UseSubscribeOption,
  ): void
  (
    type: '*',
    handler: WildcardHandler<Events>,
    option?: UseSubscribeOption,
  ): void
}

export type UseMittReturn<Events extends _Events> = {
  useSubscribe: ExtendedOn<Events>
  emit: Emitter<Events>['emit']
}

const defaultSubscribeOption: UseSubscribeOption = {
  enabled: true,
}

function useMitt<Events extends _Events>(
  mitt?: Emitter<Events>,
): UseMittReturn<Events> {
  const emitterRef = useRef<Emitter<Events> | undefined>(undefined)
  if (!emitterRef.current)
    emitterRef.current = mitt ?? create<Events>()

  if (mitt && emitterRef.current !== mitt) {
    emitterRef.current.off('*')
    emitterRef.current = mitt
  }
  const emitter = emitterRef.current
  const useSubscribe: ExtendedOn<Events> = (
    type: string,
    handler: any,
    option?: UseSubscribeOption,
  ) => {
    const { enabled } = merge(defaultSubscribeOption, option)
    useEffect(() => {
      if (enabled) {
        emitter.on(type, handler)
        return () => emitter.off(type, handler)
      }
    })
  }
  return {
    emit: emitter.emit,
    useSubscribe,
  }
}

export { useMitt }
