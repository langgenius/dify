'use client'

import type { useMitt } from '@/hooks/use-mitt'
import { noop } from 'es-toolkit/function'
import { createContext, useContext, useContextSelector } from 'use-context-selector'

type ContextValueType = ReturnType<typeof useMitt>
export const MittContext = createContext<ContextValueType>({
  emit: noop,
  useSubscribe: noop,
})

export const useMittContext = () => {
  return useContext(MittContext)
}

export function useMittContextSelector<T>(selector: (value: ContextValueType) => T): T {
  return useContextSelector(MittContext, selector)
}
