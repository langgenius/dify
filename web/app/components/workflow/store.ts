import { create } from 'zustand'
import type { SelectedNode } from './types'

type State = {
  mode: string
  selectedNode: SelectedNode | null
}

type Action = {
  setSelectedNode: (node: SelectedNode | null) => void
}

export const useStore = create<State & Action>(set => ({
  mode: 'workflow',
  selectedNode: null,
  setSelectedNode: node => set(() => ({ selectedNode: node })),
}))
