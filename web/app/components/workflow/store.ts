import { create } from 'zustand'

type State = {
  mode: string
  showRunHistory: boolean
  showFeaturesPanel: boolean
  showFeaturesModal: boolean
  runStaus: string
}

type Action = {
  setShowRunHistory: (showRunHistory: boolean) => void
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  setShowFeaturesModal: (showFeaturesModal: boolean) => void
  setRunStaus: (runStaus: string) => void
}

export const useStore = create<State & Action>(set => ({
  mode: 'workflow',
  showRunHistory: false,
  setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
  showFeaturesPanel: false,
  setShowFeaturesPanel: showFeaturesPanel => set(() => ({ showFeaturesPanel })),
  showFeaturesModal: false,
  setShowFeaturesModal: showFeaturesModal => set(() => ({ showFeaturesModal })),
  runStaus: '',
  setRunStaus: runStaus => set(() => ({ runStaus })),
}))
