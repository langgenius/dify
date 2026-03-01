import { noop } from 'es-toolkit/function'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { useMitt } from '@/hooks/use-mitt'

type ContextValueType = ReturnType<typeof useMitt>
export const MittContext = createContext<ContextValueType>({
  emit: noop,
  useSubscribe: noop,
})

export const MittProvider = ({ children }: { children: React.ReactNode }) => {
  const mitt = useMitt()

  return (
    <MittContext.Provider value={mitt}>
      {children}
    </MittContext.Provider>
  )
}

export const useMittContext = () => {
  return useContext(MittContext)
}

export function useMittContextSelector<T>(selector: (value: ContextValueType) => T): T {
  return useContextSelector(MittContext, selector)
}
