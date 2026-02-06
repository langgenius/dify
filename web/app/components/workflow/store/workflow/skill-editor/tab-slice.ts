import type { StateCreator } from 'zustand'
import type { OpenTabOptions, SkillEditorSliceShape, TabSliceShape } from './types'
import { START_TAB_ID } from '@/app/components/workflow/skill/constants'

export type { OpenTabOptions, TabSliceShape } from './types'

export const createTabSlice: StateCreator<
  SkillEditorSliceShape,
  [],
  [],
  TabSliceShape
> = (set, get) => ({
  openTabIds: [],
  activeTabId: START_TAB_ID,
  previewTabId: null,
  editorAutoFocusFileId: null,

  openTab: (fileId: string, options?: OpenTabOptions) => {
    const { openTabIds, activeTabId, previewTabId, editorAutoFocusFileId } = get()
    const isPinned = options?.pinned ?? false
    const autoFocusEditor = options?.autoFocusEditor ?? false

    if (openTabIds.includes(fileId)) {
      const nextState: Partial<TabSliceShape> = {}
      if (isPinned && previewTabId === fileId) {
        nextState.activeTabId = fileId
        nextState.previewTabId = null
      }
      else if (activeTabId !== fileId) {
        nextState.activeTabId = fileId
      }

      if (autoFocusEditor)
        nextState.editorAutoFocusFileId = fileId

      if (Object.keys(nextState).length > 0)
        set(nextState)
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
        editorAutoFocusFileId: autoFocusEditor ? fileId : editorAutoFocusFileId,
      })
    }
    else {
      set({
        openTabIds: [...newOpenTabIds, fileId],
        activeTabId: fileId,
        editorAutoFocusFileId: autoFocusEditor ? fileId : editorAutoFocusFileId,
      })
    }
  },

  closeTab: (fileId: string) => {
    const { openTabIds, activeTabId, previewTabId, editorAutoFocusFileId } = get()
    const newOpenTabIds = openTabIds.filter(id => id !== fileId)

    let newActiveTabId = activeTabId
    if (activeTabId === fileId) {
      const closedIndex = openTabIds.indexOf(fileId)
      if (newOpenTabIds.length > 0)
        newActiveTabId = newOpenTabIds[Math.min(closedIndex, newOpenTabIds.length - 1)]
      else
        newActiveTabId = START_TAB_ID
    }

    let newPreviewTabId: string | null = null
    if (previewTabId !== fileId && previewTabId && newOpenTabIds.includes(previewTabId))
      newPreviewTabId = previewTabId

    set({
      openTabIds: newOpenTabIds,
      activeTabId: newActiveTabId,
      previewTabId: newPreviewTabId,
      editorAutoFocusFileId: editorAutoFocusFileId === fileId ? null : editorAutoFocusFileId,
    })
  },

  activateTab: (fileId: string) => {
    const { openTabIds } = get()
    if (fileId === START_TAB_ID || openTabIds.includes(fileId))
      set({ activeTabId: fileId })
  },

  pinTab: (fileId: string) => {
    const { previewTabId, openTabIds } = get()
    if (!openTabIds.includes(fileId))
      return
    if (previewTabId === fileId)
      set({ previewTabId: null })
  },

  clearEditorAutoFocus: (fileId?: string) => {
    const { editorAutoFocusFileId } = get()
    if (!editorAutoFocusFileId)
      return
    if (!fileId || editorAutoFocusFileId === fileId)
      set({ editorAutoFocusFileId: null })
  },

  isPreviewTab: (fileId: string) => {
    return get().previewTabId === fileId
  },
})
