import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { DataSourceContext } from './provider'
import type { CommonShape } from './slices/common'
import { createCommonSlice } from './slices/common'
import type { LocalFileSliceShape } from './slices/local-file'
import { createLocalFileSlice } from './slices/local-file'
import type { OnlineDocumentSliceShape } from './slices/online-document'
import { createOnlineDocumentSlice } from './slices/online-document'
import type { WebsiteCrawlSliceShape } from './slices/website-crawl'
import { createWebsiteCrawlSlice } from './slices/website-crawl'
import type { OnlineDriveSliceShape } from './slices/online-drive'
import { createOnlineDriveSlice } from './slices/online-drive'

export type DataSourceShape = CommonShape
  & LocalFileSliceShape
  & OnlineDocumentSliceShape
  & WebsiteCrawlSliceShape
  & OnlineDriveSliceShape

export const createDataSourceStore = () => {
  return createStore<DataSourceShape>((...args) => ({
    ...createCommonSlice(...args),
    ...createLocalFileSlice(...args),
    ...createOnlineDocumentSlice(...args),
    ...createWebsiteCrawlSlice(...args),
    ...createOnlineDriveSlice(...args),
  }))
}

export const useDataSourceStoreWithSelector = <T>(selector: (state: DataSourceShape) => T): T => {
  const store = useContext(DataSourceContext)
  if (!store)
    throw new Error('Missing DataSourceContext.Provider in the tree')

  return useStore(store, selector)
}

export const useDataSourceStore = () => {
  const store = useContext(DataSourceContext)
  if (!store)
    throw new Error('Missing DataSourceContext.Provider in the tree')

  return store
}
