import type { StateCreator } from 'zustand'

export type FileOperationsMenuSliceShape = {
  contextMenu: {
    top: number
    left: number
    nodeId: string
  } | null
  setContextMenu: (menu: FileOperationsMenuSliceShape['contextMenu']) => void
}

export const createFileOperationsMenuSlice: StateCreator<FileOperationsMenuSliceShape> = set => ({
  contextMenu: null,

  setContextMenu: (contextMenu) => {
    set({ contextMenu })
  },
})
