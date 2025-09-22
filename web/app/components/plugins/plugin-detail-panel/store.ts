import { create } from 'zustand'
import type { PluginDetail } from '../types'

type Shape = {
  detail: PluginDetail | undefined
  setDetail: (detail: PluginDetail) => void
}

export const usePluginStore = create<Shape>(set => ({
  detail: undefined,
  setDetail: (detail: PluginDetail) => set({ detail }),
}))

type ShapeSubscription = {
  refresh?: () => void
  setRefresh: (refresh: () => void) => void
}

export const usePluginSubscriptionStore = create<ShapeSubscription>(set => ({
  refresh: undefined,
  setRefresh: (refresh: () => void) => set({ refresh }),
}))
