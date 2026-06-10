'use client'

import type { useMitt } from '@/hooks/use-mitt'
import { noop } from 'es-toolkit/function'
import { createContext, useContextSelector } from 'use-context-selector'

type ContextValueType = ReturnType<typeof useMitt>
export const MittContext = createContext<ContextValueType>({
  emit: noop,
  useSubscribe: noop,
})

export function useMittContextSelector<T>(selector: (value: ContextValueType) => T): T {
  return useContextSelector(MittContext, selector)
}
