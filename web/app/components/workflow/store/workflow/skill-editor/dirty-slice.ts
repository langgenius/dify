import type { StateCreator } from 'zustand'

export type DirtySliceShape = {
  dirtyContents: Map<string, string>
  setDraftContent: (fileId: string, content: string) => void
  clearDraftContent: (fileId: string) => void
  isDirty: (fileId: string) => boolean
  getDraftContent: (fileId: string) => string | undefined
}

export const createDirtySlice: StateCreator<DirtySliceShape> = (set, get) => ({
  dirtyContents: new Map<string, string>(),

  setDraftContent: (fileId: string, content: string) => {
    const { dirtyContents } = get()
    const newMap = new Map(dirtyContents)
    newMap.set(fileId, content)
    set({ dirtyContents: newMap })
  },

  clearDraftContent: (fileId: string) => {
    const { dirtyContents } = get()
    const newMap = new Map(dirtyContents)
    newMap.delete(fileId)
    set({ dirtyContents: newMap })
  },

  isDirty: (fileId: string) => {
    return get().dirtyContents.has(fileId)
  },

  getDraftContent: (fileId: string) => {
    return get().dirtyContents.get(fileId)
  },
})
