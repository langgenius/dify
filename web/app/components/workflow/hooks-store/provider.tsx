import type { Shape } from './store'
import { createContext, useEffect, useState } from 'react'
import { useStore } from 'reactflow'
import { createHooksStore } from './store'

type HooksStore = ReturnType<typeof createHooksStore>
export const HooksStoreContext = createContext<HooksStore | null | undefined>(null)
type HooksStoreContextProviderProps = Partial<Shape> & {
  children: React.ReactNode
}
export const HooksStoreContextProvider = ({
  children,
  ...restProps
}: HooksStoreContextProviderProps) => {
  const [store] = useState(() => createHooksStore(restProps))
  const d3Selection = useStore((s) => s.d3Selection)
  const d3Zoom = useStore((s) => s.d3Zoom)
  const { accessControl } = restProps

  useEffect(() => {
    if (d3Selection && d3Zoom) store.getState().refreshAll(restProps)
  }, [d3Selection, d3Zoom, store])

  useEffect(() => {
    if (accessControl) store.getState().refreshAll({ accessControl })
  }, [accessControl, store])

  return <HooksStoreContext.Provider value={store}>{children}</HooksStoreContext.Provider>
}
