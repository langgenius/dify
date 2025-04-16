import type { FC } from 'react'
import { createContext, useRef } from 'react'
import { createCurrentVarsStore } from './store'

type CurrentVarsStoreApi = ReturnType<typeof createCurrentVarsStore>

type CurrentVarsContextType = CurrentVarsStoreApi | undefined

export const CurrentVarsContext = createContext<CurrentVarsContextType>(undefined)

type CurrentVarsProviderProps = {
  children: React.ReactNode
}

const CurrentVarsProvider: FC<CurrentVarsProviderProps> = ({
  children,
}) => {
  const storeRef = useRef<CurrentVarsStoreApi>()

  if (!storeRef.current)
    storeRef.current = createCurrentVarsStore()

  return (
    <CurrentVarsContext.Provider value={storeRef.current!}>
      {children}
    </CurrentVarsContext.Provider>
  )
}

export default CurrentVarsProvider
