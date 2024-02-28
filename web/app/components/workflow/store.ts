import { create } from 'zustand'

type State = {
  mode: string
  showRunHistory: boolean
  showFeatures: boolean
}

type Action = {
  setShowRunHistory: (showRunHistory: boolean) => void
  setShowFeatures: (showFeatures: boolean) => void
}

export const useStore = create<State & Action>(set => ({
  mode: 'workflow',
  showRunHistory: false,
  setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
  showFeatures: false,
  setShowFeatures: showFeatures => set(() => ({ showFeatures })),
}))
