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
