import type { StateCreator } from 'zustand'

export type WorkflowSliceShape = {
  appId: string
  appName: string
  notInitialWorkflow: boolean
  setNotInitialWorkflow: (notInitialWorkflow: boolean) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
}

export type CreateWorkflowSlice = StateCreator<WorkflowSliceShape>
export const createWorkflowSlice: StateCreator<WorkflowSliceShape> = set => ({
  appId: '',
  appName: '',
  notInitialWorkflow: false,
  setNotInitialWorkflow: notInitialWorkflow => set(() => ({ notInitialWorkflow })),
  nodesDefaultConfigs: {},
  setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
})
