import type { StateCreator } from 'zustand'
import type { ClipboardSliceShape, SkillEditorSliceShape } from './types'

export type { ClipboardSliceShape } from './types'

export const createClipboardSlice: StateCreator<
  SkillEditorSliceShape,
  [],
  [],
  ClipboardSliceShape
> = (set, get) => ({
  clipboard: null,

  cutNodes: (nodeIds) => {
    if (nodeIds.length === 0)
      return
    set({ clipboard: { operation: 'cut', nodeIds: new Set(nodeIds) } })
  },

  clearClipboard: () => {
    set({ clipboard: null })
  },

  isCutNode: (nodeId) => {
    const { clipboard } = get()
    return clipboard?.operation === 'cut' && clipboard.nodeIds.has(nodeId)
  },

  hasClipboard: () => {
    return get().clipboard !== null
  },
})
