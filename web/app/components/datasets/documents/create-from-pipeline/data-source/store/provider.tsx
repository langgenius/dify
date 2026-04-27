import type { DataSourceShape } from './'
import { createStoreContext, useStoreRef } from '@/stores/create-context-store'
import { createDataSourceStore } from './'

export const DataSourceContext = createStoreContext<DataSourceShape>('DataSource')

type DataSourceProviderProps = {
  children: React.ReactNode
}

const DataSourceProvider = ({
  children,
}: DataSourceProviderProps) => {
  const store = useStoreRef(() => createDataSourceStore())

  return (
    <DataSourceContext.Provider value={store}>
      {children}
    </DataSourceContext.Provider>
  )
}

export default DataSourceProvider
