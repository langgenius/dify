import type { StateCreator } from 'zustand'
import type { FileOperationsMenuSliceShape, SkillEditorSliceShape } from './types'

export type { FileOperationsMenuSliceShape } from './types'

export const createFileOperationsMenuSlice: StateCreator<
  SkillEditorSliceShape,
  [],
  [],
  FileOperationsMenuSliceShape
> = set => ({
  contextMenu: null,

  setContextMenu: (contextMenu) => {
    set({ contextMenu })
  },
})
