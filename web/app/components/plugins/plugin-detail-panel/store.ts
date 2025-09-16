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
