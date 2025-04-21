import type { StateCreator } from 'zustand'

export type RagPipelineSliceShape = {
  showInputFieldEditor: boolean
  setShowInputFieldEditor: (showInputFieldDialog: boolean) => void
  showInputFieldPanel: boolean
  setShowInputFieldPanel: (showInputFieldPanel: boolean) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
}

export type CreateRagPipelineSliceSlice = StateCreator<RagPipelineSliceShape>
export const createRagPipelineSliceSlice: StateCreator<RagPipelineSliceShape> = set => ({
  showInputFieldEditor: false,
  setShowInputFieldEditor: showInputFieldEditor => set(() => ({ showInputFieldEditor })),
  showInputFieldPanel: false,
  setShowInputFieldPanel: showInputFieldPanel => set(() => ({ showInputFieldPanel })),
  nodesDefaultConfigs: {},
  setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
})
