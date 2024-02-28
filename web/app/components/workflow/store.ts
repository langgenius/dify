import { create } from 'zustand'

type State = {
  mode: string
  showRunHistory: boolean
}

type Action = {
  setShowRunHistory: (showRunHistory: boolean) => void
}

export const useStore = create<State & Action>(set => ({
  mode: 'workflow',
  showRunHistory: false,
  setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
}))
