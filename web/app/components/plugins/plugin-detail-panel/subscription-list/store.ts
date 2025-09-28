import { create } from 'zustand'

export type SubscriptionListDetail = {
  plugin_id: string
  // name: string
  provider: string
  declaration: {
    tool?: any
    endpoint?: any
    trigger?: any
    name?: string
    meta?: {
      version?: string
    }
  }
  version?: string
}

type Shape = {
  detail: SubscriptionListDetail | undefined
  setDetail: (detail: SubscriptionListDetail) => void
}

export const usePluginStore = create<Shape>(set => ({
  detail: undefined,
  setDetail: (detail: SubscriptionListDetail) => set({ detail }),
}))

type ShapeSubscription = {
  refresh?: () => void
  setRefresh: (refresh: () => void) => void
}

export const usePluginSubscriptionStore = create<ShapeSubscription>(set => ({
  refresh: undefined,
  setRefresh: (refresh: () => void) => set({ refresh }),
}))
