import {
  createContext,
  useContext,
  useRef,
} from 'react'
import { createJsonSchemaConfigStore } from './store'
import { useMitt } from '@/hooks/use-mitt'

type JsonSchemaConfigStore = ReturnType<typeof createJsonSchemaConfigStore>

type JsonSchemaConfigContextType = JsonSchemaConfigStore | null

type JsonSchemaConfigProviderProps = {
  children: React.ReactNode
}

export const JsonSchemaConfigContext = createContext<JsonSchemaConfigContextType>(null)

export const JsonSchemaConfigContextProvider = ({ children }: JsonSchemaConfigProviderProps) => {
  const storeRef = useRef<JsonSchemaConfigStore>()

  if (!storeRef.current)
    storeRef.current = createJsonSchemaConfigStore()

  return (
    <JsonSchemaConfigContext.Provider value={storeRef.current}>
      {children}
    </JsonSchemaConfigContext.Provider>
  )
}

export const MittContext = createContext<ReturnType<typeof useMitt>>({
  emit: () => {},
  useSubscribe: () => {},
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
