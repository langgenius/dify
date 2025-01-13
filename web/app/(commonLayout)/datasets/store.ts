import { create } from 'zustand'

type DatasetStore = {
  showExternalApiPanel: boolean
  setShowExternalApiPanel: (show: boolean) => void
}

export const useDatasetStore = create<DatasetStore>(set => ({
  showExternalApiPanel: false,
  setShowExternalApiPanel: show => set({ showExternalApiPanel: show }),
}))
