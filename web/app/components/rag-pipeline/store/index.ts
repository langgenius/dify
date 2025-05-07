import type { StateCreator } from 'zustand'

export type RagPipelineSliceShape = {
  pipelineId: string
  showInputFieldDialog: boolean
  setShowInputFieldDialog: (showInputFieldPanel: boolean) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
  showTestRunPanel: boolean
  setShowTestRunPanel: (showTestRunPanel: boolean) => void
}

export type CreateRagPipelineSliceSlice = StateCreator<RagPipelineSliceShape>
export const createRagPipelineSliceSlice: StateCreator<RagPipelineSliceShape> = set => ({
  pipelineId: '',
  showInputFieldDialog: false,
  setShowInputFieldDialog: showInputFieldDialog => set(() => ({ showInputFieldDialog })),
  nodesDefaultConfigs: {},
  setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
  showTestRunPanel: false,
  setShowTestRunPanel: showTestRunPanel => set(() => ({ showTestRunPanel })),
})
