import type { StateCreator, StoreApi } from 'zustand'
import * as React from 'react'
import { useContext } from 'react'
import { useStore as useZustandStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

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

export const createTabSlice: StateCreator<TabSliceShape> = (set, get) => ({
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

export type SkillEditorShape
  = TabSliceShape
    & FileTreeSliceShape
    & DirtySliceShape
    & FileOperationsMenuSliceShape
    & {
      reset: () => void
    }

export const createSkillEditorStore = (): StoreApi<SkillEditorShape> => {
  return createStore<SkillEditorShape>((...args) => ({
    ...createTabSlice(...args),
    ...createFileTreeSlice(...args),
    ...createDirtySlice(...args),
    ...createFileOperationsMenuSlice(...args),

    reset: () => {
      const [set] = args
      set({
        openTabIds: [],
        activeTabId: null,
        previewTabId: null,
        expandedFolderIds: new Set<string>(),
        dirtyContents: new Map<string, string>(),
        contextMenu: null,
      })
    },
  }))
}

export type SkillEditorStore = StoreApi<SkillEditorShape>

export const SkillEditorContext = React.createContext<SkillEditorStore | null>(null)

export function useSkillEditorStore<T>(selector: (state: SkillEditorShape) => T): T {
  const store = useContext(SkillEditorContext)
  if (!store)
    throw new Error('Missing SkillEditorContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useSkillEditorStoreApi = (): SkillEditorStore => {
  const store = useContext(SkillEditorContext)
  if (!store)
    throw new Error('Missing SkillEditorContext.Provider in the tree')

  return store
}
