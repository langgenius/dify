import type { StateCreator } from 'zustand'

export type ToolSliceShape = {
  toolPublished: boolean
  setToolPublished: (toolPublished: boolean) => void
  lastPublishedHasUserInput: boolean
  setLastPublishedHasUserInput: (hasUserInput: boolean) => void
}

export const createToolSlice: StateCreator<ToolSliceShape> = set => ({
  toolPublished: false,
  setToolPublished: toolPublished => set(() => ({ toolPublished })),
  lastPublishedHasUserInput: false,
  setLastPublishedHasUserInput: hasUserInput => set(() => ({ lastPublishedHasUserInput: hasUserInput })),
})
