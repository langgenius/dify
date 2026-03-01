import type { DataSet } from '@/models/datasets'
import { produce } from 'immer'
import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { DatasetsDetailContext } from './provider'

type DatasetsDetailStore = {
  datasetsDetail: Record<string, DataSet>
  updateDatasetsDetail: (datasetsDetail: DataSet[]) => void
}

export const createDatasetsDetailStore = () => {
  return createStore<DatasetsDetailStore>((set, get) => ({
    datasetsDetail: {},
    updateDatasetsDetail: (datasets: DataSet[]) => {
      const oldDatasetsDetail = get().datasetsDetail
      const datasetsDetail = datasets.reduce<Record<string, DataSet>>((acc, dataset) => {
        acc[dataset.id] = dataset
        return acc
      }, {})
      // Merge new datasets detail into old one
      const newDatasetsDetail = produce(oldDatasetsDetail, (draft) => {
        Object.entries(datasetsDetail).forEach(([key, value]) => {
          draft[key] = value
        })
      })
      set({ datasetsDetail: newDatasetsDetail })
    },
  }))
}

export const useDatasetsDetailStore = <T>(selector: (state: DatasetsDetailStore) => T): T => {
  const store = useContext(DatasetsDetailContext)
  if (!store)
    throw new Error('Missing DatasetsDetailContext.Provider in the tree')

  return useStore(store, selector)
}
