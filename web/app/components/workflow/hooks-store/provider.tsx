import type { Shape } from './store'
import { useStore,
} from '@xyflow/react'
import {
  createContext,
  useEffect,
  useRef,
} from 'react'
import {
  createHooksStore,
} from './store'

type HooksStore = ReturnType<typeof createHooksStore>
export const HooksStoreContext = createContext<HooksStore | null | undefined>(null)
type HooksStoreContextProviderProps = Partial<Shape> & {
  children: React.ReactNode
}
export const HooksStoreContextProvider = ({ children, ...restProps }: HooksStoreContextProviderProps) => {
  const storeRef = useRef<HooksStore | undefined>(undefined)
  const panZoom = useStore(s => s.panZoom)

  useEffect(() => {
    if (storeRef.current && panZoom)
      storeRef.current.getState().refreshAll(restProps)
  }, [panZoom])

  if (!storeRef.current)
    storeRef.current = createHooksStore(restProps)

  return (
    <HooksStoreContext.Provider value={storeRef.current}>
      {children}
    </HooksStoreContext.Provider>
  )
}
