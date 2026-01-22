import type { PluginDetail } from '@/app/components/plugins/types'
import { create } from 'zustand'

export enum ReadmeShowType {
  drawer = 'drawer',
  modal = 'modal',
}

type Shape = {
  currentPluginDetail?: {
    detail: PluginDetail
    showType: ReadmeShowType
    position?: 'left' | 'right'
  }
  setCurrentPluginDetail: (detail?: PluginDetail, showType?: ReadmeShowType, position?: 'left' | 'right') => void
}

export const useReadmePanelStore = create<Shape>(set => ({
  currentPluginDetail: undefined,
  setCurrentPluginDetail: (detail?: PluginDetail, showType?: ReadmeShowType, position?: 'left' | 'right') => set({
    currentPluginDetail: !detail
      ? undefined
      : {
          detail,
          showType: showType ?? ReadmeShowType.drawer,
          position,
        },
  }),
}))
