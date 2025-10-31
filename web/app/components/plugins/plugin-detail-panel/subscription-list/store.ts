import { create } from 'zustand'

type ShapeSubscription = {
  refresh?: () => void
  setRefresh: (refresh: () => void) => void
}

export const usePluginSubscriptionStore = create<ShapeSubscription>(set => ({
  refresh: undefined,
  setRefresh: (refresh: () => void) => set({ refresh }),
}))
