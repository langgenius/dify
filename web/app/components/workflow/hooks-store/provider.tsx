import {
  createContext,
  useEffect,
  useRef,
} from 'react'
import { useStore } from 'reactflow'
import {
  createHooksStore,
} from './store'
import type { Shape } from './store'

type HooksStore = ReturnType<typeof createHooksStore>
export const HooksStoreContext = createContext<HooksStore | null | undefined>(null)
type HooksStoreContextProviderProps = Partial<Shape> & {
  children: React.ReactNode
}
export const HooksStoreContextProvider = ({ children, ...restProps }: HooksStoreContextProviderProps) => {
  const storeRef = useRef<HooksStore | undefined>(undefined)
  const d3Selection = useStore(s => s.d3Selection)
  const d3Zoom = useStore(s => s.d3Zoom)

  useEffect(() => {
    if (storeRef.current && d3Selection && d3Zoom)
      storeRef.current.getState().refreshAll(restProps)
  }, [d3Selection, d3Zoom])

  if (!storeRef.current)
    storeRef.current = createHooksStore(restProps)

  return (
    <HooksStoreContext.Provider value={storeRef.current}>
      {children}
    </HooksStoreContext.Provider>
  )
}
