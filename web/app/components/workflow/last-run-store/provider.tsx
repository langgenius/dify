import type { FC } from 'react'
import { createContext, useRef } from 'react'
import { createLastRunStore } from './store'

type LastRunStoreApi = ReturnType<typeof createLastRunStore>

type LastRunContextType = LastRunStoreApi | undefined

export const LastRunContext = createContext<LastRunContextType>(undefined)

type LastRunProviderProps = {
  children: React.ReactNode
}

const LastRunProvider: FC<LastRunProviderProps> = ({
  children,
}) => {
  const storeRef = useRef<LastRunStoreApi>()

  if (!storeRef.current)
    storeRef.current = createLastRunStore()

  return (
    <LastRunContext.Provider value={storeRef.current!}>
      {children}
    </LastRunContext.Provider>
  )
}

export default LastRunProvider
