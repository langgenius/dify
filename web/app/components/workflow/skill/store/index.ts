import type { StateCreator, StoreApi } from 'zustand'
import * as React from 'react'
import { useContext } from 'react'
import { useStore as useZustandStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * SkillEditorStore - Zustand Store for Skill Editor
 *
 * Based on MVP Design Document (docs/design/skill-editor-file-list-tab-mvp-design.md)
 *
 * Key principles:
 * - Server data via TanStack Query (useGetAppAssetTree, etc.)
 * - Client store only for UI state (tabs, expanded folders, dirty contents)
 * - Store uses fileId only, tab display name derived from tree data
 */

// ============================================================================
// Tab Slice
// ============================================================================

export type TabSliceShape = {
  /** Ordered list of open tab file IDs */
  openTabIds: string[]
  /** Currently active tab file ID */
  activeTabId: string | null
  /** Preview tab file ID (MVP: not enabled, kept null) */
  previewTabId: string | null

  /** Open a file as a tab (and activate it) */
  openTab: (fileId: string) => void
  /** Close a tab */
  closeTab: (fileId: string) => void
  /** Activate a tab (without opening) */
  activateTab: (fileId: string) => void
}

export const createTabSlice: StateCreator<TabSliceShape> = (set, get) => ({
  openTabIds: [],
  activeTabId: null,
  previewTabId: null, // MVP: Preview mode not enabled

  openTab: (fileId: string) => {
    const { openTabIds, activeTabId } = get()
    // If already open, just activate
    if (openTabIds.includes(fileId)) {
      if (activeTabId !== fileId)
        set({ activeTabId: fileId })
      return
    }
    // Add to tabs and activate
    set({
      openTabIds: [...openTabIds, fileId],
      activeTabId: fileId,
    })
  },

  closeTab: (fileId: string) => {
    const { openTabIds, activeTabId } = get()
    const newOpenTabIds = openTabIds.filter(id => id !== fileId)

    // If closing the active tab, activate adjacent tab
    let newActiveTabId = activeTabId
    if (activeTabId === fileId) {
      const closedIndex = openTabIds.indexOf(fileId)
      if (newOpenTabIds.length > 0) {
        // Prefer next, fallback to previous
        newActiveTabId = newOpenTabIds[Math.min(closedIndex, newOpenTabIds.length - 1)]
      }
      else {
        newActiveTabId = null
      }
    }

    set({
      openTabIds: newOpenTabIds,
      activeTabId: newActiveTabId,
    })
  },

  activateTab: (fileId: string) => {
    const { openTabIds } = get()
    if (openTabIds.includes(fileId))
      set({ activeTabId: fileId })
  },
})

// ============================================================================
// File Tree Slice
// ============================================================================

export type FileTreeSliceShape = {
  /** Set of expanded folder IDs (controlled by react-arborist) */
  expandedFolderIds: Set<string>

  /** Update expanded folder IDs (controlled mode) */
  setExpandedFolderIds: (ids: Set<string>) => void
  /** Toggle a folder's expanded state */
  toggleFolder: (folderId: string) => void
  /** Reveal a file by expanding all ancestor folders */
  revealFile: (fileId: string, ancestorFolderIds: string[]) => void
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

  revealFile: (_fileId: string, ancestorFolderIds: string[]) => {
    const { expandedFolderIds } = get()
    const newSet = new Set(expandedFolderIds)
    // Expand all ancestors
    ancestorFolderIds.forEach(id => newSet.add(id))
    set({ expandedFolderIds: newSet })
  },
})

// ============================================================================
// Dirty State Slice
// ============================================================================

export type DirtySliceShape = {
  /** Map of fileId -> edited content (only stores modified files) */
  dirtyContents: Map<string, string>

  /** Set draft content for a file (marks as dirty) */
  setDraftContent: (fileId: string, content: string) => void
  /** Clear draft content (after successful save) */
  clearDraftContent: (fileId: string) => void
  /** Check if a file has unsaved changes */
  isDirty: (fileId: string) => boolean
  /** Get draft content for a file (or undefined if not dirty) */
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

// ============================================================================
// Combined Store Shape
// ============================================================================

export type SkillEditorShape
  = TabSliceShape
    & FileTreeSliceShape
    & DirtySliceShape
    & {
    /** Reset all state (called when appId changes) */
      reset: () => void
    }

// ============================================================================
// Store Factory
// ============================================================================

export const createSkillEditorStore = (): StoreApi<SkillEditorShape> => {
  return createStore<SkillEditorShape>((...args) => ({
    ...createTabSlice(...args),
    ...createFileTreeSlice(...args),
    ...createDirtySlice(...args),

    reset: () => {
      const [set] = args
      set({
        openTabIds: [],
        activeTabId: null,
        previewTabId: null,
        expandedFolderIds: new Set<string>(),
        dirtyContents: new Map<string, string>(),
      })
    },
  }))
}

// ============================================================================
// Context and Hooks
// ============================================================================

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
