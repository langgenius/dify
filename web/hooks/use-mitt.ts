import type { Emitter, EventType, Handler, WildcardHandler } from 'mitt'
import create from 'mitt'
import { useCallback, useEffect, useRef, useState } from 'react'

const merge = <T extends Record<string, any>>(...args: Array<T | undefined>): T => {
  return Object.assign({}, ...args)
}

type _Events = Record<EventType, unknown>

type UseSubscribeOption = {
  /**
   * Whether the subscription is enabled.
   * @default true
   */
  enabled: boolean
}

type ExtendedOn<Events extends _Events> = {
  <Key extends keyof Events>(
    type: Key,
    handler: Handler<Events[Key]>,
    options?: UseSubscribeOption,
  ): void
  (type: '*', handler: WildcardHandler<Events>, option?: UseSubscribeOption): void
}

type UseMittReturn<Events extends _Events> = {
  useSubscribe: ExtendedOn<Events>
  emit: Emitter<Events>['emit']
}

const defaultSubscribeOption: UseSubscribeOption = {
  enabled: true,
}

function useMitt<Events extends _Events>(mitt?: Emitter<Events>): UseMittReturn<Events> {
  const [internalEmitter] = useState(() => create<Events>())
  const emitterRef = useRef(mitt ?? internalEmitter)

  useEffect(() => {
    if (!mitt || emitterRef.current === mitt) return

    emitterRef.current.off('*')
    emitterRef.current = mitt
  }, [mitt])

  const emit = useCallback(<Key extends keyof Events>(type: Key, event?: Events[Key]) => {
    emitterRef.current.emit(type, event as Events[Key])
  }, []) as Emitter<Events>['emit']

  const useSubscribe: ExtendedOn<Events> = (
    type: string,
    handler: any,
    option?: UseSubscribeOption,
  ) => {
    const { enabled } = merge(defaultSubscribeOption, option)
    useEffect(() => {
      if (enabled) {
        const emitter = mitt ?? emitterRef.current
        emitter.on(type, handler)
        return () => emitter.off(type, handler)
      }
    })
  }
  return {
    emit,
    useSubscribe,
  }
}

export { useMitt }
