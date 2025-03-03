import { useContext } from 'react'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import { ApoContext } from './context'

type Shape = {
  showRecommendModal: boolean
  setShowRecommendModal: (showRecommendModal: boolean,) => void
  apoToolType: string
  setApoToolType: (apoToolType: any[],) => void
}

export const createApoStore = () => {
  return createStore<Shape>(set => ({
    showRecommendModal: false,
    setShowRecommendModal: (show) => {
      set({ showRecommendModal: show })
    },
    apoToolType: '',
    setApoToolType: apoToolType => set(() => ({ apoToolType })),
  }))
}

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = useContext(ApoContext)
  if (!store)
    throw new Error('Missing ApoContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useApoStore = () => {
  return useContext(ApoContext)!
}
