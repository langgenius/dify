import { create } from 'zustand'
import type { PluginDetail } from '../../types'

type SimpleDetail = Pick<PluginDetail, 'plugin_id' | 'declaration' | 'name'> & { provider: string }

type Shape = {
  detail: SimpleDetail | undefined
  setDetail: (detail?: SimpleDetail) => void
}

export const usePluginStore = create<Shape>(set => ({
  detail: undefined,
  setDetail: (detail?: SimpleDetail) => set({ detail }),
}))

type ShapeSubscription = {
  refresh?: () => void
  setRefresh: (refresh: () => void) => void
}

export const usePluginSubscriptionStore = create<ShapeSubscription>(set => ({
  refresh: undefined,
  setRefresh: (refresh: () => void) => set({ refresh }),
}))
