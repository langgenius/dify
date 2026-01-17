import type { StateCreator } from 'zustand'

export type OpensObject = Record<string, boolean>

export type FileTreeSliceShape = {
  expandedFolderIds: Set<string>
  setExpandedFolderIds: (ids: Set<string>) => void
  toggleFolder: (folderId: string) => void
  revealFile: (ancestorFolderIds: string[]) => void
  setExpandedFromOpens: (opens: OpensObject) => void
  getOpensObject: () => OpensObject
}

export const createFileTreeSlice: StateCreator<FileTreeSliceShape> = (set, get) => ({
  expandedFolderIds: new Set<string>(),

  setExpandedFolderIds: (ids: Set<string>) => {
    set({ expandedFolderIds: ids })
  },

  toggleFolder: (folderId: string) => {
    const { expandedFolderIds } = get()
    const newSet = new Set(expandedFolderIds)
    if (newSet.has(folderId))
      newSet.delete(folderId)
    else
      newSet.add(folderId)

    set({ expandedFolderIds: newSet })
  },

  revealFile: (ancestorFolderIds: string[]) => {
    const { expandedFolderIds } = get()
    const newSet = new Set(expandedFolderIds)
    ancestorFolderIds.forEach(id => newSet.add(id))
    set({ expandedFolderIds: newSet })
  },

  setExpandedFromOpens: (opens: OpensObject) => {
    const newSet = new Set<string>(
      Object.entries(opens)
        .filter(([_, isOpen]) => isOpen)
        .map(([id]) => id),
    )
    set({ expandedFolderIds: newSet })
  },

  getOpensObject: () => {
    const { expandedFolderIds } = get()
    return Object.fromEntries(
      [...expandedFolderIds].map(id => [id, true]),
    )
  },
})
