import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import type { DataSet } from '@/models/datasets'
import { DatasetsDetailContext } from './provider'
import { fetchDatasets } from '@/service/datasets'

type DatasetsDetailStore = {
  datasetsDetail: DataSet[]
  updateDatasetsDetail: (allDatasetIds: string[]) => Promise<void>
}

export const createDatasetsDetailStore = () => {
  return createStore<DatasetsDetailStore>(set => ({
    datasetsDetail: [],
    updateDatasetsDetail: async (allDatasetIds) => {
      const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: allDatasetIds } })
      set({ datasetsDetail: dataSetsWithDetail })
    },
  }))
}

export const useDatasetsDetailStore = <T>(selector: (state: DatasetsDetailStore) => T): T => {
  const store = useContext(DatasetsDetailContext)
  if (!store)
    throw new Error('Missing DatasetsDetailContext.Provider in the tree')

  return useStore(store, selector)
}
