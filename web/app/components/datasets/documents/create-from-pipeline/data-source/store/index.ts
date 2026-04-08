import type { CommonShape } from './slices/common'
import type { LocalFileSliceShape } from './slices/local-file'
import type { OnlineDocumentSliceShape } from './slices/online-document'
import type { OnlineDriveSliceShape } from './slices/online-drive'
import type { WebsiteCrawlSliceShape } from './slices/website-crawl'
import { createStore } from 'zustand/vanilla'
import { useContextStore, useContextStoreApi } from '@/stores/create-context-store'
import { DataSourceContext } from './provider'
import { createCommonSlice } from './slices/common'
import { createLocalFileSlice } from './slices/local-file'
import { createOnlineDocumentSlice } from './slices/online-document'
import { createOnlineDriveSlice } from './slices/online-drive'
import { createWebsiteCrawlSlice } from './slices/website-crawl'

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

export function useDataSourceStoreWithSelector<T>(selector: (state: DataSourceShape) => T): T {
  return useContextStore(DataSourceContext, selector)
}

export function useDataSourceStore() {
  return useContextStoreApi(DataSourceContext)
}
