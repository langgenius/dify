import { create } from 'zustand'

type State = {
  mode: string
  showRunHistory: boolean
  showFeatures: boolean
  runStaus: string
}

type Action = {
  setShowRunHistory: (showRunHistory: boolean) => void
  setShowFeatures: (showFeatures: boolean) => void
  setRunStaus: (runStaus: string) => void
}

export const useStore = create<State & Action>(set => ({
  mode: 'workflow',
  showRunHistory: false,
  setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
  showFeatures: false,
  setShowFeatures: showFeatures => set(() => ({ showFeatures })),
  runStaus: '',
  setRunStaus: runStaus => set(() => ({ runStaus })),
}))
