import type { StateCreator } from 'zustand'
import type { Edge, Node } from '../../types'

export type FlowGraph = {
  nodes: Node[]
  edges: Edge[]
}

export type VibeWorkflowSliceShape = {
  vibePanelMermaidCode: string
  setVibePanelMermaidCode: (vibePanelMermaidCode: string) => void
  isVibeGenerating: boolean
  setIsVibeGenerating: (isVibeGenerating: boolean) => void
  vibePanelInstruction: string
  setVibePanelInstruction: (vibePanelInstruction: string) => void
  vibeFlowVersions: FlowGraph[]
  setVibeFlowVersions: (versions: FlowGraph[]) => void
  vibeFlowCurrentIndex: number
  setVibeFlowCurrentIndex: (index: number) => void
  addVibeFlowVersion: (version: FlowGraph) => void
  currentVibeFlow: FlowGraph | undefined
}

const getCurrentVibeFlow = (versions: FlowGraph[], currentIndex: number): FlowGraph | undefined => {
  if (!versions || versions.length === 0)
    return undefined
  const index = currentIndex ?? 0
  if (index < 0)
    return undefined
  return versions[index] || versions[versions.length - 1]
}

export const createVibeWorkflowSlice: StateCreator<VibeWorkflowSliceShape> = (set, get) => ({
  vibePanelMermaidCode: '',
  setVibePanelMermaidCode: vibePanelMermaidCode => set(() => ({ vibePanelMermaidCode })),
  isVibeGenerating: false,
  setIsVibeGenerating: isVibeGenerating => set(() => ({ isVibeGenerating })),
  vibePanelInstruction: '',
  setVibePanelInstruction: vibePanelInstruction => set(() => ({ vibePanelInstruction })),
  vibeFlowVersions: [],
  setVibeFlowVersions: versions => set((state) => {
    const currentVibeFlow = getCurrentVibeFlow(versions, state.vibeFlowCurrentIndex)
    return { vibeFlowVersions: versions, currentVibeFlow }
  }),
  vibeFlowCurrentIndex: 0,
  setVibeFlowCurrentIndex: (index) => {
    const state = get()
    const versions = state.vibeFlowVersions || []

    if (!versions || versions.length === 0) {
      set({ vibeFlowCurrentIndex: 0, currentVibeFlow: undefined })
      return
    }

    const normalizedIndex = Math.min(Math.max(index, 0), versions.length - 1)
    const currentVibeFlow = getCurrentVibeFlow(versions, normalizedIndex)
    set({ vibeFlowCurrentIndex: normalizedIndex, currentVibeFlow })
  },
  addVibeFlowVersion: (version) => {
    // Prevent adding empty graphs
    if (!version || !version.nodes || version.nodes.length === 0) {
      set({ vibeFlowCurrentIndex: -1, currentVibeFlow: undefined })
      return
    }

    set((state) => {
      const newVersions = [...(state.vibeFlowVersions || []), version]
      const newIndex = newVersions.length - 1
      const currentVibeFlow = getCurrentVibeFlow(newVersions, newIndex)
      return {
        vibeFlowVersions: newVersions,
        vibeFlowCurrentIndex: newIndex,
        currentVibeFlow,
      }
    })
  },
  currentVibeFlow: undefined,
})
