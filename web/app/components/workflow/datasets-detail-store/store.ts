import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import type { DataSet } from '@/models/datasets'
import { DatasetsDetailContext } from './provider'

type DatasetsDetailStore = {
  datasetsDetail: DataSet[]
  setDatasetsDetail: (datasetsDetail: DataSet[]) => void
}

export const createDatasetsDetailStore = () => {
  return createStore<DatasetsDetailStore>(set => ({
    datasetsDetail: [],
    setDatasetsDetail: datasetsDetail => set({ datasetsDetail }),
  }))
}

export const useDatasetsDetailStore = <T>(selector: (state: DatasetsDetailStore) => T): T => {
  const store = useContext(DatasetsDetailContext)
  if (!store)
    throw new Error('Missing DatasetsDetailContext.Provider in the tree')

  return useStore(store, selector)
}
