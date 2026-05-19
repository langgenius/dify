import type { PluginDetail } from '@/app/components/plugins/types'
import { create } from 'zustand'

export type ReadmePanelPresentation = 'drawer' | 'dialog'

type ReadmePanelState = {
  detail: PluginDetail
  presentation: ReadmePanelPresentation
  triggerId?: string
}

type OpenReadmePanelPayload = {
  detail: PluginDetail
  presentation?: ReadmePanelPresentation
  triggerId?: string
}

type Shape = {
  currentPanel?: ReadmePanelState
  openReadmePanel: (payload: OpenReadmePanelPayload) => void
  closeReadmePanel: () => void
}

export const useReadmePanelStore = create<Shape>(set => ({
  currentPanel: undefined,
  openReadmePanel: ({ detail, presentation = 'drawer', triggerId }) => set({
    currentPanel: {
      detail,
      presentation,
      triggerId,
    },
  }),
  closeReadmePanel: () => set({ currentPanel: undefined }),
}))
