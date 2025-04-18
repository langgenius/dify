import type { StateCreator } from 'zustand'

export type RagPipelineSliceShape = {
  showInputFieldDialog: boolean
  setShowInputFieldDialog: (showInputFieldDialog: boolean) => void
}

export type CreateRagPipelineSliceSlice = StateCreator<RagPipelineSliceShape>
export const createRagPipelineSliceSlice: StateCreator<RagPipelineSliceShape> = set => ({
  showInputFieldDialog: false,
  setShowInputFieldDialog: showInputFieldDialog => set(() => ({ showInputFieldDialog })),
})
