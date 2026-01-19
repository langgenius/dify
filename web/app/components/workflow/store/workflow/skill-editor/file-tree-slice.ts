import type { StateCreator } from 'zustand'
import type { FileTreeSliceShape, OpensObject, SkillEditorSliceShape } from './types'

export type { FileTreeSliceShape, OpensObject } from './types'

const createDraftId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return `draft-${crypto.randomUUID()}`
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const createFileTreeSlice: StateCreator<
  SkillEditorSliceShape,
  [],
  [],
  FileTreeSliceShape
> = (set, get) => ({
  expandedFolderIds: new Set<string>(),
  selectedTreeNodeId: null,
  createTargetNodeId: null,
  pendingCreateNode: null,

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

  setSelectedTreeNodeId: (nodeId) => {
    set({ selectedTreeNodeId: nodeId })
  },

  setCreateTargetNodeId: (nodeId) => {
    set({ createTargetNodeId: nodeId })
  },

  startCreateNode: (nodeType, parentId) => {
    set({
      pendingCreateNode: {
        id: createDraftId(),
        parentId,
        nodeType,
      },
    })
  },

  clearCreateNode: () => {
    set({ pendingCreateNode: null })
  },

  dragOverFolderId: null,

  setDragOverFolderId: (folderId) => {
    set({ dragOverFolderId: folderId })
  },
})
