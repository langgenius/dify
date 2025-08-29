import { create } from 'zustand'
import type { PluginDetail } from '../types'

export type SimpleDetail = Pick<PluginDetail, 'plugin_id' | 'declaration' | 'name' | 'plugin_unique_identifier' | 'id'> & { provider: string }

type Shape = {
  detail: SimpleDetail | undefined
  setDetail: (detail?: SimpleDetail) => void
}

export const usePluginStore = create<Shape>(set => ({
  detail: undefined,
  setDetail: (detail?: SimpleDetail) => set({ detail }),
}))
