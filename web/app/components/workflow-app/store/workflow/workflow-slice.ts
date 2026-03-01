import type { StateCreator } from 'zustand'

export type WorkflowSliceShape = {
  appId: string
  appName: string
  notInitialWorkflow: boolean
  setNotInitialWorkflow: (notInitialWorkflow: boolean) => void
  shouldAutoOpenStartNodeSelector: boolean
  setShouldAutoOpenStartNodeSelector: (shouldAutoOpen: boolean) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
  showOnboarding: boolean
  setShowOnboarding: (showOnboarding: boolean) => void
  hasSelectedStartNode: boolean
  setHasSelectedStartNode: (hasSelectedStartNode: boolean) => void
  hasShownOnboarding: boolean
  setHasShownOnboarding: (hasShownOnboarding: boolean) => void
}

export type CreateWorkflowSlice = StateCreator<WorkflowSliceShape>
export const createWorkflowSlice: StateCreator<WorkflowSliceShape> = set => ({
  appId: '',
  appName: '',
  notInitialWorkflow: false,
  setNotInitialWorkflow: notInitialWorkflow => set(() => ({ notInitialWorkflow })),
  shouldAutoOpenStartNodeSelector: false,
  setShouldAutoOpenStartNodeSelector: shouldAutoOpenStartNodeSelector => set(() => ({ shouldAutoOpenStartNodeSelector })),
  nodesDefaultConfigs: {},
  setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
  showOnboarding: false,
  setShowOnboarding: showOnboarding => set(() => ({ showOnboarding })),
  hasSelectedStartNode: false,
  setHasSelectedStartNode: hasSelectedStartNode => set(() => ({ hasSelectedStartNode })),
  hasShownOnboarding: false,
  setHasShownOnboarding: hasShownOnboarding => set(() => ({ hasShownOnboarding })),
})
