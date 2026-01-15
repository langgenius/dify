import type { StateCreator } from 'zustand'
import type { ToolWithProvider } from '../../types'

export type ToolSliceShape = {
  toolPublished: boolean
  setToolPublished: (toolPublished: boolean) => void
  lastPublishedHasUserInput: boolean
  setLastPublishedHasUserInput: (hasUserInput: boolean) => void
  buildInTools?: ToolWithProvider[]
  customTools?: ToolWithProvider[]
  workflowTools?: ToolWithProvider[]
  mcpTools?: ToolWithProvider[]
}

export const createToolSlice: StateCreator<ToolSliceShape> = set => ({
  toolPublished: false,
  setToolPublished: toolPublished => set(() => ({ toolPublished })),
  lastPublishedHasUserInput: false,
  setLastPublishedHasUserInput: hasUserInput => set(() => ({ lastPublishedHasUserInput: hasUserInput })),
  buildInTools: undefined,
  customTools: undefined,
  workflowTools: undefined,
  mcpTools: undefined,
})
