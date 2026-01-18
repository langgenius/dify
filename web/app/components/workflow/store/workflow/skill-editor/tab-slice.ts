import type { StateCreator } from 'zustand'
import type { OpenTabOptions, SkillEditorSliceShape, TabSliceShape } from './types'

export type { OpenTabOptions, TabSliceShape } from './types'

export const createTabSlice: StateCreator<
  SkillEditorSliceShape,
  [],
  [],
  TabSliceShape
> = (set, get) => ({
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

    let newPreviewTabId: string | null = null
    if (previewTabId !== fileId && previewTabId && newOpenTabIds.includes(previewTabId))
      newPreviewTabId = previewTabId

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
