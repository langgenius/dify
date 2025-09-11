import { createContext, use } from 'react'
import { useMitt } from '@/hooks/use-mitt'
import { noop } from 'lodash-es'

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
  return use(MittContext)
}

export function useMittContextSelector<T>(selector: (value: ContextValueType) => T): T {
  return selector(use(MittContext))
}
