import type { StateCreator } from 'zustand'

export type VibeWorkflowSliceShape = {
  vibePanelMermaidCode: string
  setVibePanelMermaidCode: (vibePanelMermaidCode: string) => void
  isVibeGenerating: boolean
  setIsVibeGenerating: (isVibeGenerating: boolean) => void
  vibePanelInstruction: string
  setVibePanelInstruction: (vibePanelInstruction: string) => void
}

export const createVibeWorkflowSlice: StateCreator<VibeWorkflowSliceShape> = set => ({
  vibePanelMermaidCode: '',
  setVibePanelMermaidCode: vibePanelMermaidCode => set(() => ({ vibePanelMermaidCode })),
  isVibeGenerating: false,
  setIsVibeGenerating: isVibeGenerating => set(() => ({ isVibeGenerating })),
  vibePanelInstruction: '',
  setVibePanelInstruction: vibePanelInstruction => set(() => ({ vibePanelInstruction })),
})
