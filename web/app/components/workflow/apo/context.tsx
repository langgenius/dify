import {
  createContext,
  useRef,
} from 'react'
import { createApoStore } from './store'

type ApoStore = ReturnType<typeof createApoStore>
export const ApoContext = createContext<ApoStore | null>(null)

type ApoProviderProps = {
  children: React.ReactNode
}
export const ApoContextProvider = ({ children }: ApoProviderProps) => {
  const storeRef = useRef<ApoStore>()

  if (!storeRef.current)
    storeRef.current = createApoStore()

  return (
    <ApoContext.Provider value={storeRef.current}>
      {children}
    </ApoContext.Provider>
  )
}
