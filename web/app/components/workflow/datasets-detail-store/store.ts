import type { DataSet } from '@/models/datasets'
import { produce } from 'immer'
import { use } from 'react'
import { createStore, useStore } from 'zustand'
import { DatasetsDetailContext } from './provider'

type DatasetsDetailStore = {
  datasetsDetail: Record<string, DataSet>
  updateDatasetsDetail: (datasetsDetail: DataSet[], requestedIds?: string[]) => void
}

export const createDatasetsDetailStore = () => {
  return createStore<DatasetsDetailStore>((set, get) => ({
    datasetsDetail: {},
    updateDatasetsDetail: (datasets: DataSet[], requestedIds?: string[]) => {
      const oldDatasetsDetail = get().datasetsDetail
      const datasetsDetail = datasets.reduce<Record<string, DataSet>>((acc, dataset) => {
        acc[dataset.id] = dataset
        return acc
      }, {})
      const newDatasetsDetail = produce(oldDatasetsDetail, (draft) => {
        requestedIds?.forEach((id) => {
          if (!datasetsDetail[id])
            delete draft[id]
        })
        Object.entries(datasetsDetail).forEach(([key, value]) => {
          draft[key] = value
        })
      })
      set({ datasetsDetail: newDatasetsDetail })
    },
  }))
}

export const useDatasetsDetailStore = <T>(selector: (state: DatasetsDetailStore) => T): T => {
  const store = use(DatasetsDetailContext)
  if (!store)
    throw new Error('Missing DatasetsDetailContext.Provider in the tree')

  return useStore(store, selector)
}
