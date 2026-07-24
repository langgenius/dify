import { createContext, useRef } from 'react'
import { createDataSourceStore } from './'

type DataSourceStoreApi = ReturnType<typeof createDataSourceStore>

type DataSourceContextType = DataSourceStoreApi | null

export const DataSourceContext = createContext<DataSourceContextType>(null)

type DataSourceProviderProps = {
  children: React.ReactNode
}

const DataSourceProvider = ({
  children,
}: DataSourceProviderProps) => {
  const storeRef = useRef<DataSourceStoreApi>(null)

  if (!storeRef.current)
    storeRef.current = createDataSourceStore()

  return (
    <DataSourceContext.Provider value={storeRef.current!}>
      {children}
    </DataSourceContext.Provider>
  )
}

export default DataSourceProvider
