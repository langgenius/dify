import type { StateCreator } from 'zustand'

export type OpenTabOptions = {
  /** true = Pinned (permanent), false/undefined = Preview (temporary) */
  pinned?: boolean
}

export type TabSliceShape = {
  /** Ordered list of open tab file IDs */
  openTabIds: string[]
  /** Currently active tab file ID */
  activeTabId: string | null
  /** Current preview tab file ID (at most one) */
  previewTabId: string | null
  /** Open a file tab with optional pinned mode */
  openTab: (fileId: string, options?: OpenTabOptions) => void
  /** Close a tab */
  closeTab: (fileId: string) => void
  /** Activate an existing tab */
  activateTab: (fileId: string) => void
  /** Convert preview tab to pinned tab */
  pinTab: (fileId: string) => void
  /** Check if a tab is in preview mode */
  isPreviewTab: (fileId: string) => boolean
}

const createTabSlice: StateCreator<TabSliceShape> = (set, get) => ({
  openTabIds: [],
  activeTabId: null,
  previewTabId: null,

  openTab: (fileId: string, options?: OpenTabOptions) => {
    const { openTabIds, activeTabId, previewTabId } = get()
    const isPinned = options?.pinned ?? false

    if (openTabIds.includes(fileId)) {
      if (isPinned && previewTabId === fileId)
        set({ activeTabId: fileId, previewTabId: null })
      else if (activeTabId !== fileId)
        set({ activeTabId: fileId })
      return
    }

    let newOpenTabIds = [...openTabIds]

    if (!isPinned) {
      if (previewTabId && openTabIds.includes(previewTabId))
        newOpenTabIds = newOpenTabIds.filter(id => id !== previewTabId)
      set({
        openTabIds: [...newOpenTabIds, fileId],
        activeTabId: fileId,
        previewTabId: fileId,
      })
    }
    else {
      set({
        openTabIds: [...newOpenTabIds, fileId],
        activeTabId: fileId,
      })
    }
  },

  closeTab: (fileId: string) => {
    const { openTabIds, activeTabId, previewTabId } = get()
    const newOpenTabIds = openTabIds.filter(id => id !== fileId)

    let newActiveTabId = activeTabId
    if (activeTabId === fileId) {
      const closedIndex = openTabIds.indexOf(fileId)
      if (newOpenTabIds.length > 0)
        newActiveTabId = newOpenTabIds[Math.min(closedIndex, newOpenTabIds.length - 1)]
      else
        newActiveTabId = null
    }

    const newPreviewTabId = previewTabId === fileId
      ? null
      : (previewTabId && newOpenTabIds.includes(previewTabId) ? previewTabId : null)

    set({
      openTabIds: newOpenTabIds,
      activeTabId: newActiveTabId,
      previewTabId: newPreviewTabId,
    })
  },

  activateTab: (fileId: string) => {
    const { openTabIds } = get()
    if (openTabIds.includes(fileId))
      set({ activeTabId: fileId })
  },

  pinTab: (fileId: string) => {
    const { previewTabId, openTabIds } = get()
    if (!openTabIds.includes(fileId))
      return
    if (previewTabId === fileId)
      set({ previewTabId: null })
  },

  isPreviewTab: (fileId: string) => {
    return get().previewTabId === fileId
  },
})

export type OpensObject = Record<string, boolean>

export type FileTreeSliceShape = {
  expandedFolderIds: Set<string>
  setExpandedFolderIds: (ids: Set<string>) => void
  toggleFolder: (folderId: string) => void
  revealFile: (ancestorFolderIds: string[]) => void
  setExpandedFromOpens: (opens: OpensObject) => void
  getOpensObject: () => OpensObject
}

const createFileTreeSlice: StateCreator<FileTreeSliceShape> = (set, get) => ({
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

export type DirtySliceShape = {
  dirtyContents: Map<string, string>
  setDraftContent: (fileId: string, content: string) => void
  clearDraftContent: (fileId: string) => void
  isDirty: (fileId: string) => boolean
  getDraftContent: (fileId: string) => string | undefined
}

const createDirtySlice: StateCreator<DirtySliceShape> = (set, get) => ({
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

export type MetadataSliceShape = {
  fileMetadata: Map<string, Record<string, any>>
  dirtyMetadataIds: Set<string>
  setFileMetadata: (fileId: string, metadata: Record<string, any>) => void
  setDraftMetadata: (fileId: string, metadata: Record<string, any>) => void
  clearDraftMetadata: (fileId: string) => void
  clearFileMetadata: (fileId: string) => void
  isMetadataDirty: (fileId: string) => boolean
  getFileMetadata: (fileId: string) => Record<string, any> | undefined
}

const createMetadataSlice: StateCreator<MetadataSliceShape> = (set, get) => ({
  fileMetadata: new Map<string, Record<string, any>>(),
  dirtyMetadataIds: new Set<string>(),

  setFileMetadata: (fileId: string, metadata: Record<string, any>) => {
    const { fileMetadata } = get()
    const nextMap = new Map(fileMetadata)
    if (metadata)
      nextMap.set(fileId, metadata)
    else
      nextMap.delete(fileId)
    set({ fileMetadata: nextMap })
  },

  setDraftMetadata: (fileId: string, metadata: Record<string, any>) => {
    const { fileMetadata, dirtyMetadataIds } = get()
    const nextMap = new Map(fileMetadata)
    nextMap.set(fileId, metadata || {})
    const nextDirty = new Set(dirtyMetadataIds)
    nextDirty.add(fileId)
    set({ fileMetadata: nextMap, dirtyMetadataIds: nextDirty })
  },

  clearDraftMetadata: (fileId: string) => {
    const { dirtyMetadataIds } = get()
    if (!dirtyMetadataIds.has(fileId))
      return
    const nextDirty = new Set(dirtyMetadataIds)
    nextDirty.delete(fileId)
    set({ dirtyMetadataIds: nextDirty })
  },

  clearFileMetadata: (fileId: string) => {
    const { fileMetadata, dirtyMetadataIds } = get()
    const nextMap = new Map(fileMetadata)
    nextMap.delete(fileId)
    const nextDirty = new Set(dirtyMetadataIds)
    nextDirty.delete(fileId)
    set({ fileMetadata: nextMap, dirtyMetadataIds: nextDirty })
  },

  isMetadataDirty: (fileId: string) => {
    return get().dirtyMetadataIds.has(fileId)
  },

  getFileMetadata: (fileId: string) => {
    return get().fileMetadata.get(fileId)
  },
})

export type FileOperationsMenuSliceShape = {
  contextMenu: {
    top: number
    left: number
    nodeId: string
  } | null
  setContextMenu: (menu: FileOperationsMenuSliceShape['contextMenu']) => void
}

const createFileOperationsMenuSlice: StateCreator<FileOperationsMenuSliceShape> = set => ({
  contextMenu: null,

  setContextMenu: (contextMenu) => {
    set({ contextMenu })
  },
})

export type SkillEditorSliceShape
  = TabSliceShape
    & FileTreeSliceShape
    & DirtySliceShape
    & MetadataSliceShape
    & FileOperationsMenuSliceShape
    & {
      resetSkillEditor: () => void
    }

export const createSkillEditorSlice: StateCreator<SkillEditorSliceShape> = (set, get, store) => {
  // Type assertion via unknown to allow composition with other slices in a larger store
  // This is safe because all slice creators only use set/get for their own properties
  const tabArgs = [set, get, store] as unknown as Parameters<StateCreator<TabSliceShape>>
  const fileTreeArgs = [set, get, store] as unknown as Parameters<StateCreator<FileTreeSliceShape>>
  const dirtyArgs = [set, get, store] as unknown as Parameters<StateCreator<DirtySliceShape>>
  const metadataArgs = [set, get, store] as unknown as Parameters<StateCreator<MetadataSliceShape>>
  const menuArgs = [set, get, store] as unknown as Parameters<StateCreator<FileOperationsMenuSliceShape>>

  return {
    ...createTabSlice(...tabArgs),
    ...createFileTreeSlice(...fileTreeArgs),
    ...createDirtySlice(...dirtyArgs),
    ...createMetadataSlice(...metadataArgs),
    ...createFileOperationsMenuSlice(...menuArgs),

    resetSkillEditor: () => {
      set({
        openTabIds: [],
        activeTabId: null,
        previewTabId: null,
        expandedFolderIds: new Set<string>(),
        dirtyContents: new Map<string, string>(),
        fileMetadata: new Map<string, Record<string, any>>(),
        dirtyMetadataIds: new Set<string>(),
        contextMenu: null,
      })
    },
  }
}
