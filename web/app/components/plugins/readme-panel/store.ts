import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { PluginDetail } from '@/app/components/plugins/types'
import { create } from 'zustand'

export type ReadmePanelPresentation = 'drawer' | 'dialog'

export type ReadmePanelState = {
  detail: PluginDetail | RagPipelineDatasourceProviderResponse
  presentation: ReadmePanelPresentation
}

type OpenReadmePanelPayload = {
  detail: ReadmePanelState['detail']
  presentation?: ReadmePanelPresentation
}

type Shape = {
  isOpen: boolean
  currentPanel?: ReadmePanelState
  openReadmePanel: (payload: OpenReadmePanelPayload) => void
  closeReadmePanel: () => void
  completeReadmePanelClose: (panel: ReadmePanelState) => void
}

export const useReadmePanelStore = create<Shape>((set) => ({
  isOpen: false,
  currentPanel: undefined,
  openReadmePanel: ({ detail, presentation = 'drawer' }) =>
    set({
      isOpen: true,
      currentPanel: {
        detail,
        presentation,
      },
    }),
  closeReadmePanel: () => set({ isOpen: false }),
  completeReadmePanelClose: (panel) =>
    set((state) =>
      !state.isOpen && state.currentPanel === panel ? { currentPanel: undefined } : state,
    ),
}))
