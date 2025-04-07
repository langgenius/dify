import type { Emitter, EventType, Handler, WildcardHandler } from 'mitt'
import create from 'mitt'
import { useEffect, useRef } from 'react'

const merge = <T extends Record<string, any>>(
  ...args: Array<T | undefined>
): T => {
  return Object.assign({}, ...args)
}

export type _Events = Record<EventType, unknown>

export type UseSubcribeOption = {
  /**
     * Whether the subscription is enabled.
     * @default true
     */
  enabled: boolean;
}

export type ExtendedOn<Events extends _Events> = {
  <Key extends keyof Events>(
    type: Key,
    handler: Handler<Events[Key]>,
    options?: UseSubcribeOption,
  ): void;
  (
    type: '*',
    handler: WildcardHandler<Events>,
    option?: UseSubcribeOption,
  ): void;
}

export type UseMittReturn<Events extends _Events> = {
  useSubcribe: ExtendedOn<Events>;
  emit: Emitter<Events>['emit'];
}

const defaultSubcribeOption: UseSubcribeOption = {
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
  const useSubcribe: ExtendedOn<Events> = (
    type: string,
    handler: any,
    option?: UseSubcribeOption,
  ) => {
    const { enabled } = merge(defaultSubcribeOption, option)
    useEffect(() => {
      if (enabled) {
        emitter.on(type, handler)
        return () => emitter.off(type, handler)
      }
    })
  }
  return {
    emit: emitter.emit,
    useSubcribe,
  }
}

export { useMitt }
