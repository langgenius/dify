import { createContext } from 'react'
import { useRefWithInit } from '@/hooks/use-ref-with-init'
import { createDataSourceStore } from './'

type DataSourceStoreApi = ReturnType<typeof createDataSourceStore>

type DataSourceContextType = DataSourceStoreApi | null

export const DataSourceContext = createContext<DataSourceContextType>(null)

type DataSourceProviderProps = {
  children: React.ReactNode
}

const DataSourceProvider = ({ children }: DataSourceProviderProps) => {
  const storeRef = useRefWithInit(createDataSourceStore)

  return (
    <DataSourceContext.Provider value={storeRef.current}>{children}</DataSourceContext.Provider>
  )
}

export default DataSourceProvider
