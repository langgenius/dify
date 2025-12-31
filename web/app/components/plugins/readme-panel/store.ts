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
  }
  setCurrentPluginDetail: (detail?: PluginDetail, showType?: ReadmeShowType) => void
}

export const useReadmePanelStore = create<Shape>(set => ({
  currentPluginDetail: undefined,
  setCurrentPluginDetail: (detail?: PluginDetail, showType?: ReadmeShowType) => set({
    currentPluginDetail: !detail
      ? undefined
      : {
          detail,
          showType: showType ?? ReadmeShowType.drawer,
        },
  }),
}))
